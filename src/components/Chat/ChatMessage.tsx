"use client";

import { useMemo } from "react";
import { ChatToolCall } from "./ChatToolCall";
import type { ChatMessage as ChatMessageType, ToolCall } from "@/hooks/useChat";

interface ChatMessageProps {
  message: ChatMessageType;
  isLast?: boolean;
}

// Simple markdown parser
function parseMarkdown(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  const lines = text.split("\n");
  let inCodeBlock = false;
  let codeBlockContent: string[] = [];
  let codeBlockLang = "";
  let key = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // Code block start/end
    if (line.startsWith("```")) {
      if (inCodeBlock) {
        // End code block
        elements.push(
          <CodeBlock key={key++} language={codeBlockLang} code={codeBlockContent.join("\n")} />
        );
        inCodeBlock = false;
        codeBlockContent = [];
        codeBlockLang = "";
      } else {
        // Start code block
        inCodeBlock = true;
        codeBlockLang = line.slice(3).trim();
      }
      continue;
    }

    if (inCodeBlock) {
      codeBlockContent.push(line);
      continue;
    }

    // Empty line
    if (!line.trim()) {
      elements.push(<br key={key++} />);
      continue;
    }

    // Headers
    if (line.startsWith("### ")) {
      elements.push(
        <h3 key={key++} className="text-lg font-semibold mt-4 mb-2">
          {parseInlineMarkdown(line.slice(4))}
        </h3>
      );
      continue;
    }
    if (line.startsWith("## ")) {
      elements.push(
        <h2 key={key++} className="text-xl font-semibold mt-4 mb-2">
          {parseInlineMarkdown(line.slice(3))}
        </h2>
      );
      continue;
    }
    if (line.startsWith("# ")) {
      elements.push(
        <h1 key={key++} className="text-2xl font-bold mt-4 mb-2">
          {parseInlineMarkdown(line.slice(2))}
        </h1>
      );
      continue;
    }

    // List items
    if (line.match(/^[-*] /)) {
      elements.push(
        <li key={key++} className="ml-4 list-disc">
          {parseInlineMarkdown(line.slice(2))}
        </li>
      );
      continue;
    }
    if (line.match(/^\d+\. /)) {
      const content = line.replace(/^\d+\. /, "");
      elements.push(
        <li key={key++} className="ml-4 list-decimal">
          {parseInlineMarkdown(content)}
        </li>
      );
      continue;
    }

    // Regular paragraph
    elements.push(
      <p key={key++} className="mb-2">
        {parseInlineMarkdown(line)}
      </p>
    );
  }

  // Handle unclosed code block
  if (inCodeBlock && codeBlockContent.length > 0) {
    elements.push(
      <CodeBlock key={key++} language={codeBlockLang} code={codeBlockContent.join("\n")} />
    );
  }

  return elements;
}

// Parse inline markdown (bold, italic, code, links)
function parseInlineMarkdown(text: string): React.ReactNode[] {
  const elements: React.ReactNode[] = [];
  let remaining = text;
  let key = 0;

  while (remaining.length > 0) {
    // Inline code
    const codeMatch = remaining.match(/^`([^`]+)`/);
    if (codeMatch) {
      elements.push(
        <code key={key++} className="px-1.5 py-0.5 bg-zinc-800 rounded text-sm font-mono text-indigo-300">
          {codeMatch[1]}
        </code>
      );
      remaining = remaining.slice(codeMatch[0].length);
      continue;
    }

    // Bold
    const boldMatch = remaining.match(/^\*\*([^*]+)\*\*/);
    if (boldMatch) {
      elements.push(<strong key={key++}>{boldMatch[1]}</strong>);
      remaining = remaining.slice(boldMatch[0].length);
      continue;
    }

    // Italic
    const italicMatch = remaining.match(/^_([^_]+)_/) || remaining.match(/^\*([^*]+)\*/);
    if (italicMatch) {
      elements.push(<em key={key++}>{italicMatch[1]}</em>);
      remaining = remaining.slice(italicMatch[0].length);
      continue;
    }

    // Links
    const linkMatch = remaining.match(/^\[([^\]]+)\]\(([^)]+)\)/);
    if (linkMatch) {
      elements.push(
        <a
          key={key++}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="text-indigo-400 hover:underline"
        >
          {linkMatch[1]}
        </a>
      );
      remaining = remaining.slice(linkMatch[0].length);
      continue;
    }

    // Plain text (find next special character or end)
    const nextSpecial = remaining.search(/[`*_\[]/);
    if (nextSpecial === -1) {
      elements.push(remaining);
      break;
    } else if (nextSpecial === 0) {
      // Special character didn't match a pattern, treat as plain text
      elements.push(remaining[0]);
      remaining = remaining.slice(1);
    } else {
      elements.push(remaining.slice(0, nextSpecial));
      remaining = remaining.slice(nextSpecial);
    }
  }

  return elements;
}

// Code block component with syntax highlighting
function CodeBlock({ language, code }: { language: string; code: string }) {
  const copyCode = () => {
    navigator.clipboard.writeText(code);
  };

  return (
    <div className="relative group my-3 rounded-lg overflow-hidden bg-zinc-900 border border-zinc-700">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/50 border-b border-zinc-700">
        <span className="text-xs text-zinc-400 font-mono">{language || "text"}</span>
        <button
          onClick={copyCode}
          className="text-xs text-zinc-400 hover:text-white transition-colors"
        >
          Copy
        </button>
      </div>
      {/* Code */}
      <pre className="p-4 overflow-x-auto">
        <code className="text-sm font-mono text-zinc-300">{code}</code>
      </pre>
    </div>
  );
}

// Thinking block component for extended thinking display
function ThinkingBlock({ content, isThinking }: { content: string; isThinking?: boolean }) {
  return (
    <div className="my-3 p-4 bg-amber-950/30 border border-amber-700/30 rounded-lg">
      <div className="flex items-center gap-2 mb-2 text-amber-400 text-sm font-medium">
        <svg className="w-4 h-4 animate-pulse" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.663 17h4.673M12 3v1m6.364 1.636l-.707.707M21 12h-1M4 12H3m3.343-5.657l-.707-.707m2.828 9.9a5 5 0 117.072 0l-.548.547A3.374 3.374 0 0014 18.469V19a2 2 0 11-4 0v-.531c0-.895-.356-1.754-.988-2.386l-.548-.547z" />
        </svg>
        <span>Extended Thinking</span>
        {isThinking && (
          <span className="ml-auto text-xs text-amber-400/70">Analyzing...</span>
        )}
      </div>
      <div className="text-sm text-amber-200/80 whitespace-pre-wrap font-mono">
        {content}
      </div>
    </div>
  );
}

export function ChatMessage({ message, isLast }: ChatMessageProps) {
  const isUser = message.role === "user";
  const parsedContent = useMemo(
    () => (isUser ? null : parseMarkdown(message.content)),
    [message.content, isUser]
  );

  // Check if message has thinking content
  const hasThinking = message.thinking && message.thinking.length > 0;
  const isThinking = message.isThinking && !hasThinking;

  return (
    <div
      className={`flex gap-4 ${isUser ? "flex-row-reverse" : ""} ${
        isLast ? "animate-fade-in" : ""
      }`}
    >
      {/* Avatar */}
      <div
        className={`flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center ${
          isUser
            ? "bg-indigo-500"
            : "bg-gradient-to-br from-purple-500 to-pink-500"
        }`}
      >
        {isUser ? (
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z" />
          </svg>
        ) : (
          <svg className="w-4 h-4 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
          </svg>
        )}
      </div>

      {/* Content */}
      <div className={`flex-1 ${isUser ? "text-right" : ""} max-w-[80%]`}>
        {/* Message bubble */}
        <div
          className={`inline-block text-left px-4 py-3 rounded-2xl ${
            isUser
              ? "bg-indigo-500 text-white"
              : "bg-zinc-800 text-zinc-100"
          }`}
        >
          {/* Thinking indicator for active thinking */}
          {isThinking && (
            <div className="mb-3">
              <ThinkingBlock content="Thinking..." isThinking={true} />
            </div>
          )}

          {/* Completed thinking content */}
          {hasThinking && (
            <ThinkingBlock content={message.thinking!} isThinking={false} />
          )}

          {isUser ? (
            <p className="whitespace-pre-wrap">{message.content}</p>
          ) : (
            <div className="prose prose-invert prose-sm max-w-none">
              {parsedContent}
              {message.isStreaming && (
                <span className="inline-block w-2 h-4 bg-zinc-400 animate-pulse ml-0.5" />
              )}
            </div>
          )}
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-2">
            {message.toolCalls.map((toolCall) => (
              <ChatToolCall key={toolCall.id} toolCall={toolCall} />
            ))}
          </div>
        )}

        {/* Metadata */}
        <div
          className={`mt-1 flex items-center gap-2 text-xs text-zinc-500 ${
            isUser ? "justify-end" : ""
          }`}
        >
          <span>
            {message.timestamp.toLocaleTimeString([], {
              hour: "2-digit",
              minute: "2-digit",
            })}
          </span>
          {message.model && (
            <>
              <span>·</span>
              <span>{message.model}</span>
            </>
          )}
          {message.outputTokens !== undefined && (
            <>
              <span>·</span>
              <span>{message.outputTokens} tokens</span>
            </>
          )}
          {(hasThinking || isThinking) && (
            <>
              <span>·</span>
              <span className="text-amber-500">🧠 Extended Thinking</span>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
