import { useState, useCallback, useRef } from "react";

export interface StreamingState {
  isStreaming: boolean;
  text: string;
  error: string | null;
}

export interface ToolCallEvent {
  type: "tool_call";
  toolName: string;
  args: unknown;
}

export interface ToolResultEvent {
  type: "tool_result";
  toolName: string;
  result: unknown;
}

export interface TextDeltaEvent {
  type: "text_delta";
  text: string;
}

export interface ErrorEvent {
  type: "error";
  error: string;
}

export interface DoneEvent {
  type: "done";
  fullText: string;
  usage?: {
    inputTokens: number;
    outputTokens: number;
  };
}

export type StreamEvent =
  | ToolCallEvent
  | ToolResultEvent
  | TextDeltaEvent
  | ErrorEvent
  | DoneEvent;

export interface UseStreamingResponseOptions {
  onToolCall?: (toolName: string, args: unknown) => void;
  onToolResult?: (toolName: string, result: unknown) => void;
  onText?: (text: string) => void;
  onDone?: (fullText: string, usage?: { inputTokens: number; outputTokens: number }) => void;
  onError?: (error: string) => void;
}

export function useStreamingResponse(options: UseStreamingResponseOptions = {}) {
  const [state, setState] = useState<StreamingState>({
    isStreaming: false,
    text: "",
    error: null,
  });

  const abortControllerRef = useRef<AbortController | null>(null);

  const startStream = useCallback(
    async (url: string, body: unknown) => {
      // Abort any existing stream
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }

      abortControllerRef.current = new AbortController();

      setState({
        isStreaming: true,
        text: "",
        error: null,
      });

      try {
        const response = await fetch(url, {
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
                const event: StreamEvent = JSON.parse(data);

                switch (event.type) {
                  case "text_delta":
                    fullText += event.text;
                    setState((prev) => ({
                      ...prev,
                      text: fullText,
                    }));
                    options.onText?.(event.text);
                    break;

                  case "tool_call":
                    options.onToolCall?.(event.toolName, event.args);
                    break;

                  case "tool_result":
                    options.onToolResult?.(event.toolName, event.result);
                    break;

                  case "error":
                    setState((prev) => ({
                      ...prev,
                      error: event.error,
                      isStreaming: false,
                    }));
                    options.onError?.(event.error);
                    break;

                  case "done":
                    setState((prev) => ({
                      ...prev,
                      text: event.fullText,
                      isStreaming: false,
                    }));
                    options.onDone?.(event.fullText, event.usage);
                    break;
                }
              } catch {
                // Ignore JSON parse errors for incomplete data
              }
            }
          }
        }
      } catch (error) {
        if ((error as Error).name === "AbortError") {
          return;
        }

        const errorMessage = error instanceof Error ? error.message : "Stream error";
        setState((prev) => ({
          ...prev,
          error: errorMessage,
          isStreaming: false,
        }));
        options.onError?.(errorMessage);
      }
    },
    [options]
  );

  const stopStream = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setState((prev) => ({
      ...prev,
      isStreaming: false,
    }));
  }, []);

  const reset = useCallback(() => {
    stopStream();
    setState({
      isStreaming: false,
      text: "",
      error: null,
    });
  }, [stopStream]);

  return {
    ...state,
    startStream,
    stopStream,
    reset,
  };
}
