import { useState, useCallback, useRef, useEffect } from "react";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: Date;
  toolCalls?: ToolCall[];
  isStreaming?: boolean;
  model?: string;
  inputTokens?: number;
  outputTokens?: number;
  thinking?: string; // Extended thinking content from Claude
  isThinking?: boolean; // Currently showing thinking UI
}

export interface ToolCall {
  id: string;
  name: string;
  args: unknown;
  result?: unknown;
  status: "pending" | "executing" | "completed" | "error";
  error?: string;
}

export interface ChatOptions {
  conversationId?: number | null;
  providerId?: number | null;
  onNewConversation?: (conversationId: number) => void;
}

export interface SendMessageOptions {
  providerId?: number | null;
  steering?: {
    tone?: "concise" | "balanced" | "deep";
    responseStyle?: "direct" | "explanatory" | "mentor";
    requireChecklist?: boolean;
    prioritizeSafety?: boolean;
    includeReasoningSummary?: boolean;
  };
}

interface ActiveStreamState {
  streamId: string;
  assistantMessageId: string;
  conversationId: number | null;
  lastSeq: number;
  startedAt: number;
  messages: Array<{
    id: string;
    role: "user" | "assistant" | "system";
    content: string;
    timestamp: string;
    toolCalls?: ToolCall[];
    isStreaming?: boolean;
    model?: string;
    inputTokens?: number;
    outputTokens?: number;
    thinking?: string;
    isThinking?: boolean;
  }>;
}

const ACTIVE_STREAM_STORAGE_KEY = "overseer.chat.active-stream";
const LAST_CONVERSATION_STORAGE_KEY = "overseer.chat.last-conversation-id";

function getStorage(): Storage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function saveActiveStream(state: ActiveStreamState) {
  const storage = getStorage();
  if (!storage) return;
  storage.setItem(ACTIVE_STREAM_STORAGE_KEY, JSON.stringify(state));
}

function loadActiveStream(): ActiveStreamState | null {
  const storage = getStorage();
  if (!storage) return null;

  const raw = storage.getItem(ACTIVE_STREAM_STORAGE_KEY);
  if (!raw) return null;

  try {
    return JSON.parse(raw) as ActiveStreamState;
  } catch {
    storage.removeItem(ACTIVE_STREAM_STORAGE_KEY);
    return null;
  }
}

function clearActiveStream() {
  const storage = getStorage();
  if (!storage) return;
  storage.removeItem(ACTIVE_STREAM_STORAGE_KEY);
}

export function useChat(options: ChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(
    options.conversationId ?? null,
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentAssistantMessageIdRef = useRef<string | null>(null);
  const activeStreamRef = useRef<ActiveStreamState | null>(null);
  const unmountedRef = useRef(false);

  // Load conversation history for externally-selected conversation
  useEffect(() => {
    if (options.conversationId) {
      setConversationId(options.conversationId);
      loadConversation(options.conversationId);
    }
  }, [options.conversationId]);

  // Restore last conversation after refresh (when no explicit conversation is selected)
  useEffect(() => {
    if (options.conversationId !== undefined && options.conversationId !== null) return;
    if (conversationId !== null) return;

    // If there's an in-flight stream to resume, prefer that state over restoring a completed conversation.
    if (loadActiveStream()) return;

    const storage = getStorage();
    if (!storage) return;
    const raw = storage.getItem(LAST_CONVERSATION_STORAGE_KEY);
    const parsed = raw ? Number.parseInt(raw, 10) : NaN;
    if (!Number.isFinite(parsed) || parsed <= 0) return;

    setConversationId(parsed);
    void loadConversation(parsed).catch(() => {
      // If the conversation no longer exists / is forbidden, clear the stored id.
      storage.removeItem(LAST_CONVERSATION_STORAGE_KEY);
      setConversationId(null);
    });
    // run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Persist last active conversation id (durable across refresh)
  useEffect(() => {
    const storage = getStorage();
    if (!storage) return;
    if (!conversationId) return;
    try {
      storage.setItem(LAST_CONVERSATION_STORAGE_KEY, String(conversationId));
    } catch {
      // ignore storage errors (quota/private mode)
    }
  }, [conversationId]);

  // Resume an active stream after refresh/navigation
  useEffect(() => {
    unmountedRef.current = false;
    const saved = loadActiveStream();
    if (!saved) {
      return () => {
        unmountedRef.current = true;
      };
    }

    const restoredMessages: ChatMessage[] = saved.messages.map((m) => ({
      ...m,
      timestamp: new Date(m.timestamp),
    }));

    setMessages(restoredMessages);
    if (saved.conversationId) {
      setConversationId(saved.conversationId);
      options.onNewConversation?.(saved.conversationId);
    }
    setIsLoading(true);
    activeStreamRef.current = saved;
    currentAssistantMessageIdRef.current = saved.assistantMessageId;

    const pollResume = async () => {
      const resumeToolCalls: ToolCall[] = [];

      const applyEvent = (event: Record<string, unknown>) => {
        const assistantMessageId = saved.assistantMessageId;
        switch (event.type) {
          case "conversation_id": {
            const nextConversationId = Number(event.conversationId);
            if (Number.isFinite(nextConversationId)) {
              setConversationId(nextConversationId);
              options.onNewConversation?.(nextConversationId);
              if (activeStreamRef.current) {
                activeStreamRef.current = {
                  ...activeStreamRef.current,
                  conversationId: nextConversationId,
                };
              }
            }
            break;
          }

          case "text_delta": {
            const delta = String(event.text ?? "");
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, content: (msg.content || "") + delta }
                  : msg,
              ),
            );
            break;
          }

          case "thinking": {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? {
                      ...msg,
                      thinking: String(event.content ?? ""),
                      isThinking: Boolean(event.active),
                    }
                  : msg,
              ),
            );
            break;
          }

          case "tool_call": {
            const newToolCall: ToolCall = {
              id: `tool-${Date.now()}-${String(event.toolName ?? "tool")}`,
              name: String(event.toolName ?? "tool"),
              args: event.args,
              status: "executing",
            };
            resumeToolCalls.push(newToolCall);
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, toolCalls: [...resumeToolCalls] }
                  : msg,
              ),
            );
            break;
          }

          case "tool_result": {
            const toolName = String(event.toolName ?? "");
            const idx = resumeToolCalls.findIndex(
              (tc) => tc.name === toolName && tc.status === "executing",
            );
            if (idx !== -1) {
              resumeToolCalls[idx] = {
                ...resumeToolCalls[idx],
                status: "completed",
                result: event.result,
              };
            }
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, toolCalls: [...resumeToolCalls] }
                  : msg,
              ),
            );
            break;
          }

          case "session_rollover": {
            setMessages((prev) => [
              ...prev,
              {
                id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                role: "system",
                content:
                  "Session context reached capacity. A new active session was created and context summary was carried forward.",
                timestamp: new Date(),
              },
            ]);
            break;
          }

          case "session_summarized": {
            const count = Number(event.messagesSummarized ?? 0);
            setMessages((prev) => [
              ...prev,
              {
                id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                role: "system",
                content: `Session memory compacted (${count} messages summarized) to preserve continuity.`,
                timestamp: new Date(),
              },
            ]);
            break;
          }

          case "error": {
            setError(String(event.error ?? "Unknown error"));
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? { ...msg, isStreaming: false }
                  : msg,
              ),
            );
            break;
          }

          case "done": {
            setMessages((prev) =>
              prev.map((msg) =>
                msg.id === assistantMessageId
                  ? {
                      ...msg,
                      content: String(event.fullText ?? msg.content),
                      isStreaming: false,
                      model: event.model ? String(event.model) : msg.model,
                      inputTokens: (
                        event.usage as { inputTokens?: number } | undefined
                      )?.inputTokens,
                      outputTokens: (
                        event.usage as { outputTokens?: number } | undefined
                      )?.outputTokens,
                    }
                  : msg,
              ),
            );
            break;
          }
        }
      };

      try {
        let keepPolling = true;
        while (
          keepPolling &&
          !unmountedRef.current &&
          activeStreamRef.current
        ) {
          const current = activeStreamRef.current;
          const response = await fetch(
            `/api/chat?streamId=${encodeURIComponent(current.streamId)}&from=${current.lastSeq}`,
            { cache: "no-store" },
          );

          if (!response.ok) {
            throw new Error(`Resume failed with HTTP ${response.status}`);
          }

          const data = await response.json();
          const events: Array<{ seq: number; event: Record<string, unknown> }> =
            Array.isArray(data.events) ? data.events : [];

          for (const { seq, event } of events) {
            applyEvent(event);
            if (activeStreamRef.current) {
              activeStreamRef.current.lastSeq = seq;
            }
          }

          if (data.status !== "active") {
            keepPolling = false;
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 900));
        }
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to resume stream",
        );
      } finally {
        const convId =
          activeStreamRef.current?.conversationId ??
          saved.conversationId ??
          null;
        if (convId) {
          void loadConversation(convId);
        }
        setIsLoading(false);
        currentAssistantMessageIdRef.current = null;
        activeStreamRef.current = null;
        clearActiveStream();
      }
    };

    void pollResume();

    return () => {
      unmountedRef.current = true;
    };
    // intentionally run once on mount
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const messagesToPersist = (source: ChatMessage[]) =>
    source.map((m) => ({
      id: m.id,
      role: m.role,
      content: m.content,
      timestamp: m.timestamp.toISOString(),
      toolCalls: m.toolCalls,
      isStreaming: m.isStreaming,
      model: m.model,
      inputTokens: m.inputTokens,
      outputTokens: m.outputTokens,
      thinking: m.thinking,
      isThinking: m.isThinking,
    }));

  const loadConversation = async (convId: number) => {
    try {
      const response = await fetch(`/api/chat/${convId}`);
      if (!response.ok) {
        throw new Error("Failed to load conversation");
      }

      const data = await response.json();
      const loadedMessages: ChatMessage[] = data.messages.map(
        (msg: {
          id: number;
          role: string;
          content: string;
          created_at: string;
          tool_calls?: string;
          model_used?: string;
          input_tokens?: number;
          output_tokens?: number;
        }) => ({
          id: `db-${msg.id}`,
          role: msg.role,
          content: msg.content,
          timestamp: new Date(msg.created_at),
          toolCalls: msg.tool_calls ? JSON.parse(msg.tool_calls) : undefined,
          model: msg.model_used,
          inputTokens: msg.input_tokens,
          outputTokens: msg.output_tokens,
        }),
      );

      setMessages(loadedMessages);
    } catch (err) {
      console.error("Error loading conversation:", err);
      setError("Failed to load conversation history");
    }
  };

  const sendMessage = useCallback(
    async (
      content: string,
      attachments?: File[],
      sendOptions?: SendMessageOptions,
    ) => {
      if (!content.trim() && (!attachments || attachments.length === 0)) return;

      // Cancel any ongoing request
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      abortControllerRef.current = new AbortController();

      setIsLoading(true);
      setError(null);

      // Add user message
      const userMessageId = `user-${Date.now()}`;
      const userMessage: ChatMessage = {
        id: userMessageId,
        role: "user",
        content,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, userMessage]);

      // Add placeholder assistant message
      const assistantMessageId = `assistant-${Date.now()}`;
      currentAssistantMessageIdRef.current = assistantMessageId;
      const assistantMessage: ChatMessage = {
        id: assistantMessageId,
        role: "assistant",
        content: "",
        timestamp: new Date(),
        isStreaming: true,
        toolCalls: [],
      };
      setMessages((prev) => [...prev, assistantMessage]);

      try {
        // Prepare request body
        const body: {
          message: string;
          conversationId?: number | null;
          providerId?: number | null;
          streamId: string;
          steering?: SendMessageOptions["steering"];
        } = {
          message: content,
          conversationId,
          providerId: sendOptions?.providerId ?? options.providerId,
          streamId:
            typeof crypto !== "undefined" && "randomUUID" in crypto
              ? crypto.randomUUID()
              : `stream-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
          steering: sendOptions?.steering,
        };

        activeStreamRef.current = {
          streamId: body.streamId,
          assistantMessageId,
          conversationId,
          lastSeq: 0,
          startedAt: Date.now(),
          messages: [],
        };

        const pendingSnapshot: ChatMessage[] = [userMessage, assistantMessage];
        saveActiveStream({
          ...activeStreamRef.current,
          messages: messagesToPersist(pendingSnapshot),
        });

        const response = await fetch("/api/chat", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(body),
          signal: abortControllerRef.current.signal,
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({}));
          throw new Error(errorData.error || `HTTP error ${response.status}`);
        }

        const reader = response.body?.getReader();
        if (!reader) {
          throw new Error("No response body");
        }

        const decoder = new TextDecoder();
        let buffer = "";
        let fullText = "";
        const toolCalls: ToolCall[] = [];

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() || "";

          for (const line of lines) {
            if (line.startsWith("data: ")) {
              const data = line.slice(6);
              if (data === "[DONE]") continue;

              try {
                const event = JSON.parse(data);

                switch (event.type) {
                  case "stream_initialized":
                    break;

                  case "conversation_id":
                    setConversationId(event.conversationId);
                    options.onNewConversation?.(event.conversationId);
                    if (activeStreamRef.current) {
                      activeStreamRef.current = {
                        ...activeStreamRef.current,
                        conversationId: event.conversationId,
                      };
                    }
                    break;

                  case "text_delta":
                    fullText += event.text;
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: fullText }
                          : msg,
                      ),
                    );
                    break;

                  case "thinking":
                    // Extended thinking content from Claude
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                              ...msg,
                              thinking: event.content,
                              isThinking: event.active ?? false,
                            }
                          : msg,
                      ),
                    );
                    break;

                  case "tool_call":
                    const newToolCall: ToolCall = {
                      id: `tool-${Date.now()}-${event.toolName}`,
                      name: event.toolName,
                      args: event.args,
                      status: "executing",
                    };
                    toolCalls.push(newToolCall);
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, toolCalls: [...toolCalls] }
                          : msg,
                      ),
                    );
                    break;

                  case "tool_result":
                    const toolIndex = toolCalls.findIndex(
                      (tc) =>
                        tc.name === event.toolName && tc.status === "executing",
                    );
                    if (toolIndex !== -1) {
                      toolCalls[toolIndex] = {
                        ...toolCalls[toolIndex],
                        result: event.result,
                        status: "completed",
                      };
                      setMessages((prev) =>
                        prev.map((msg) =>
                          msg.id === assistantMessageId
                            ? { ...msg, toolCalls: [...toolCalls] }
                            : msg,
                        ),
                      );
                    }
                    break;

                  case "error":
                    setError(event.error);
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                              ...msg,
                              content: fullText || `Error: ${event.error}`,
                              isStreaming: false,
                            }
                          : msg,
                      ),
                    );
                    break;

                  case "session_summarized":
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        role: "system",
                        content: `Session memory compacted (${event.messagesSummarized ?? 0} messages summarized) to keep context healthy.`,
                        timestamp: new Date(),
                      },
                    ]);
                    break;

                  case "session_rollover":
                    setMessages((prev) => [
                      ...prev,
                      {
                        id: `system-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
                        role: "system",
                        content:
                          "Session context reached capacity; agent rolled over into a fresh active session.",
                        timestamp: new Date(),
                      },
                    ]);
                    break;

                  case "done":
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? {
                              ...msg,
                              content: event.fullText,
                              isStreaming: false,
                              model: event.model,
                              inputTokens: event.usage?.inputTokens,
                              outputTokens: event.usage?.outputTokens,
                            }
                          : msg,
                      ),
                    );
                    {
                      const convId =
                        activeStreamRef.current?.conversationId ?? conversationId;
                      if (convId) {
                        void loadConversation(convId);
                      }
                    }
                    break;
                }

                if (activeStreamRef.current) {
                  const seq = Number(event.seq ?? 0);
                  if (
                    Number.isFinite(seq) &&
                    seq > activeStreamRef.current.lastSeq
                  ) {
                    activeStreamRef.current.lastSeq = seq;
                  }
                }
              } catch {
                // Ignore JSON parse errors
              }
            }
          }
        }
      } catch (err) {
        if ((err as Error).name === "AbortError") {
          return;
        }

        const errorMessage =
          err instanceof Error ? err.message : "Failed to send message";
        setError(errorMessage);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: `Error: ${errorMessage}`,
                  isStreaming: false,
                }
              : msg,
          ),
        );
      } finally {
        setIsLoading(false);
        currentAssistantMessageIdRef.current = null;
        clearActiveStream();
        activeStreamRef.current = null;
      }
    },
    [conversationId, options],
  );

  const stopGeneration = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }

    if (currentAssistantMessageIdRef.current) {
      setMessages((prev) =>
        prev.map((msg) =>
          msg.id === currentAssistantMessageIdRef.current
            ? { ...msg, isStreaming: false }
            : msg,
        ),
      );
    }

    setIsLoading(false);
    clearActiveStream();
    activeStreamRef.current = null;
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
    clearActiveStream();
    activeStreamRef.current = null;
    const storage = getStorage();
    if (storage) {
      storage.removeItem(LAST_CONVERSATION_STORAGE_KEY);
    }
  }, []);

  const regenerateLastMessage = useCallback(async () => {
    const lastUserMessage = [...messages]
      .reverse()
      .find((m: ChatMessage) => m.role === "user");
    if (!lastUserMessage) return;

    // Remove the last assistant message
    setMessages((prev) => {
      // Find last assistant index manually for compatibility
      let lastAssistantIndex = -1;
      for (let i = prev.length - 1; i >= 0; i--) {
        if (prev[i].role === "assistant") {
          lastAssistantIndex = i;
          break;
        }
      }
      if (lastAssistantIndex === -1) return prev;
      return prev.slice(0, lastAssistantIndex);
    });

    // Resend the last user message
    await sendMessage(lastUserMessage.content);
  }, [messages, sendMessage]);

  return {
    messages,
    isLoading,
    error,
    conversationId,
    sendMessage,
    stopGeneration,
    clearMessages,
    regenerateLastMessage,
  };
}
