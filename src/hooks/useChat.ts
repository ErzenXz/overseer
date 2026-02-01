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

export function useChat(options: ChatOptions = {}) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [conversationId, setConversationId] = useState<number | null>(
    options.conversationId ?? null
  );

  const abortControllerRef = useRef<AbortController | null>(null);
  const currentAssistantMessageIdRef = useRef<string | null>(null);

  // Load conversation history
  useEffect(() => {
    if (options.conversationId && options.conversationId !== conversationId) {
      setConversationId(options.conversationId);
      loadConversation(options.conversationId);
    }
  }, [options.conversationId]);

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
        })
      );

      setMessages(loadedMessages);
    } catch (err) {
      console.error("Error loading conversation:", err);
      setError("Failed to load conversation history");
    }
  };

  const sendMessage = useCallback(
    async (content: string, attachments?: File[]) => {
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
        } = {
          message: content,
          conversationId,
          providerId: options.providerId,
        };

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
                  case "conversation_id":
                    setConversationId(event.conversationId);
                    options.onNewConversation?.(event.conversationId);
                    break;

                  case "text_delta":
                    fullText += event.text;
                    setMessages((prev) =>
                      prev.map((msg) =>
                        msg.id === assistantMessageId
                          ? { ...msg, content: fullText }
                          : msg
                      )
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
                          : msg
                      )
                    );
                    break;

                  case "tool_result":
                    const toolIndex = toolCalls.findIndex(
                      (tc) => tc.name === event.toolName && tc.status === "executing"
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
                            : msg
                        )
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
                          : msg
                      )
                    );
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
                          : msg
                      )
                    );
                    break;
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

        const errorMessage = err instanceof Error ? err.message : "Failed to send message";
        setError(errorMessage);
        setMessages((prev) =>
          prev.map((msg) =>
            msg.id === assistantMessageId
              ? {
                  ...msg,
                  content: `Error: ${errorMessage}`,
                  isStreaming: false,
                }
              : msg
          )
        );
      } finally {
        setIsLoading(false);
        currentAssistantMessageIdRef.current = null;
      }
    },
    [conversationId, options]
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
            : msg
        )
      );
    }

    setIsLoading(false);
  }, []);

  const clearMessages = useCallback(() => {
    setMessages([]);
    setConversationId(null);
    setError(null);
  }, []);

  const regenerateLastMessage = useCallback(async () => {
    const lastUserMessage = [...messages].reverse().find((m: ChatMessage) => m.role === "user");
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
