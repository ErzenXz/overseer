"use client";

import { useState } from "react";
import type { ToolCall } from "@/hooks/useChat";

interface ChatToolCallProps {
  toolCall: ToolCall;
}

export function ChatToolCall({ toolCall }: ChatToolCallProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getStatusColor = () => {
    switch (toolCall.status) {
      case "pending":
        return "text-zinc-400 bg-zinc-800";
      case "executing":
        return "text-amber-400 bg-amber-500/10";
      case "completed":
        return "text-emerald-400 bg-emerald-500/10";
      case "error":
        return "text-red-400 bg-red-500/10";
      default:
        return "text-zinc-400 bg-zinc-800";
    }
  };

  const getStatusIcon = () => {
    switch (toolCall.status) {
      case "pending":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
        );
      case "executing":
        return (
          <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
        );
      case "completed":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
        );
      case "error":
        return (
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        );
    }
  };

  const getToolIcon = () => {
    const name = toolCall.name.toLowerCase();
    
    if (name.includes("shell") || name.includes("bash") || name.includes("exec")) {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      );
    }
    
    if (name.includes("file") || name.includes("read") || name.includes("write")) {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
      );
    }
    
    if (name.includes("git")) {
      return (
        <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
          <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
        </svg>
      );
    }
    
    if (name.includes("search") || name.includes("find") || name.includes("grep")) {
      return (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
        </svg>
      );
    }
    
    // Default tool icon
    return (
      <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
      </svg>
    );
  };

  const formatArgs = (args: unknown) => {
    if (typeof args === "string") return args;
    try {
      return JSON.stringify(args, null, 2);
    } catch {
      return String(args);
    }
  };

  const formatResult = (result: unknown) => {
    if (typeof result === "string") {
      // Truncate long results
      if (result.length > 500) {
        return result.slice(0, 500) + "...";
      }
      return result;
    }
    try {
      const str = JSON.stringify(result, null, 2);
      if (str.length > 500) {
        return str.slice(0, 500) + "...";
      }
      return str;
    } catch {
      return String(result);
    }
  };

  return (
    <div className={`rounded-lg border ${getStatusColor()} border-current/20`}>
      {/* Header */}
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="w-full flex items-center gap-3 px-3 py-2"
      >
        {/* Tool icon */}
        <span className="flex-shrink-0 opacity-70">{getToolIcon()}</span>

        {/* Tool name */}
        <span className="flex-1 text-left text-sm font-mono truncate">
          {toolCall.name}
        </span>

        {/* Status icon */}
        <span className="flex-shrink-0">{getStatusIcon()}</span>

        {/* Expand icon */}
        <svg
          className={`w-4 h-4 transition-transform ${isExpanded ? "rotate-180" : ""}`}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {/* Expanded content */}
      {isExpanded && (
        <div className="border-t border-current/20 p-3 space-y-3">
          {/* Arguments */}
          <div>
            <div className="text-xs text-zinc-500 mb-1">Arguments</div>
            <pre className="text-xs font-mono bg-black/20 rounded p-2 overflow-x-auto max-h-32 overflow-y-auto">
              {formatArgs(toolCall.args)}
            </pre>
          </div>

          {/* Result */}
          {toolCall.result !== undefined && (
            <div>
              <div className="text-xs text-zinc-500 mb-1">Result</div>
              <pre className="text-xs font-mono bg-black/20 rounded p-2 overflow-x-auto max-h-48 overflow-y-auto">
                {formatResult(toolCall.result)}
              </pre>
            </div>
          )}

          {/* Error */}
          {toolCall.error && (
            <div>
              <div className="text-xs text-red-400 mb-1">Error</div>
              <pre className="text-xs font-mono bg-red-500/10 rounded p-2 text-red-300">
                {toolCall.error}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
