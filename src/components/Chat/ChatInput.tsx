"use client";

import { useState, useRef, useEffect } from "react";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

interface SandboxFileEntry {
 name: string;
 path: string;
 type: "file" | "directory";
}

interface ListedDirResponse {
 success: boolean;
 entries?: SandboxFileEntry[];
}

// Web Speech API types
interface SpeechRecognitionEvent extends Event {
 resultIndex: number;
 results: SpeechRecognitionResultList;
}

interface SpeechRecognitionResultList {
 length: number;
 [index: number]: SpeechRecognitionResult;
}

interface SpeechRecognitionResult {
 [index: number]: SpeechRecognitionAlternative;
 isFinal: boolean;
 length: number;
}

interface SpeechRecognitionAlternative {
 transcript: string;
 confidence: number;
}

interface SpeechRecognitionInstance extends EventTarget {
 continuous: boolean;
 interimResults: boolean;
 lang: string;
 onresult: ((event: SpeechRecognitionEvent) => void) | null;
 onerror: ((event: Event) => void) | null;
 onend: ((event: Event) => void) | null;
 start: () => void;
 stop: () => void;
 abort: () => void;
}

interface SpeechRecognitionConstructor {
 new (): SpeechRecognitionInstance;
}

declare global {
 interface Window {
  SpeechRecognition?: SpeechRecognitionConstructor;
  webkitSpeechRecognition?: SpeechRecognitionConstructor;
 }
}

interface ChatInputProps {
 onSend: (message: string, attachments?: File[]) => void;
 isLoading: boolean;
 onStop: () => void;
 placeholder?: string;
}

export function ChatInput({
 onSend,
 isLoading,
 onStop,
 placeholder = "Type a message...",
}: ChatInputProps) {
 const [message, setMessage] = useState("");
 const [attachments, setAttachments] = useState<File[]>([]);
 const [isListening, setIsListening] = useState(false);
 const [allFiles, setAllFiles] = useState<string[]>([]);
 const [isLoadingFiles, setIsLoadingFiles] = useState(false);
 const [mentionQuery, setMentionQuery] = useState<string | null>(null);
 const textareaRef = useRef<HTMLTextAreaElement>(null);
 const fileInputRef = useRef<HTMLInputElement>(null);
 const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);

 // Auto-resize textarea
 useEffect(() => {
  if (textareaRef.current) {
   textareaRef.current.style.height = "auto";
   textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`;
  }
 }, [message]);

 // Initialize speech recognition
 useEffect(() => {
  if (typeof window !== "undefined" && ("SpeechRecognition" in window || "webkitSpeechRecognition" in window)) {
   const SpeechRecognitionCtor = window.SpeechRecognition || window.webkitSpeechRecognition;
   if (!SpeechRecognitionCtor) return;
   
   recognitionRef.current = new SpeechRecognitionCtor();
   recognitionRef.current.continuous = true;
   recognitionRef.current.interimResults = true;

   recognitionRef.current.onresult = (event) => {
    let transcript = "";
    for (let i = event.resultIndex; i < event.results.length; i++) {
     transcript += event.results[i][0].transcript;
    }
    setMessage((prev) => prev + transcript);
   };

   recognitionRef.current.onerror = () => {
    setIsListening(false);
   };

   recognitionRef.current.onend = () => {
    setIsListening(false);
   };
  }

  return () => {
   if (recognitionRef.current) {
    recognitionRef.current.abort();
   }
  };
 }, []);

 const loadAllFiles = async () => {
  if (isLoadingFiles || allFiles.length > 0) return;
  setIsLoadingFiles(true);
  try {
   const collected: string[] = [];
   const queue: Array<{ path: string; depth: number }> = [{ path: ".", depth: 0 }];
   const maxDepth = 4;

   while (queue.length > 0) {
    const next = queue.shift();
    if (!next) break;
    const res = await fetch(
     `/api/files?action=list&path=${encodeURIComponent(next.path)}`,
     { cache: "no-store" },
    );
    if (!res.ok) continue;
    const data = (await res.json()) as ListedDirResponse;
    const entries = Array.isArray(data.entries) ? data.entries : [];
    for (const entry of entries) {
     if (entry.type === "file") {
      collected.push(entry.path);
     } else if (entry.type === "directory" && next.depth < maxDepth) {
      queue.push({ path: entry.path, depth: next.depth + 1 });
     }
    }
   }

   setAllFiles(collected.sort((a, b) => a.localeCompare(b)));
  } finally {
   setIsLoadingFiles(false);
  }
 };

 useEffect(() => {
  const match = message.match(/(?:^|\s)@([^\s]*)$/);
  if (!match) {
   setMentionQuery(null);
   return;
  }

  const query = match[1] ?? "";
  setMentionQuery(query);
  void loadAllFiles();
  // eslint-disable-next-line react-hooks/exhaustive-deps
 }, [message]);

 const filteredFiles =
  mentionQuery === null
   ? []
   : allFiles
     .filter((p) => p.toLowerCase().includes(mentionQuery.toLowerCase()))
     .slice(0, 10);

 const attachExistingFile = async (path: string) => {
  const res = await fetch(
   `/api/files?action=download&path=${encodeURIComponent(path)}&disposition=inline`,
   { cache: "no-store" },
  );
  if (!res.ok) throw new Error("Failed to load file for attachment");

  const blob = await res.blob();
  const fileName = path.split("/").filter(Boolean).pop() || "file";
  const file = new File([blob], fileName, {
   type: blob.type || "application/octet-stream",
   lastModified: Date.now(),
  }) as File & { __sandboxPath?: string };

  file.__sandboxPath = path;
  setAttachments((prev) => {
   if (prev.some((f) => (f as File & { __sandboxPath?: string }).__sandboxPath === path)) {
    return prev;
   }
   return [...prev, file];
  });
 };

 const handleMentionSelect = async (path: string) => {
  // replace the currently active @query with @path
  setMessage((prev) => prev.replace(/(?:^|\s)@([^\s]*)$/, (m) => m.replace(/@[^\s]*$/, `@${path}`)) + " ");
  setMentionQuery(null);
  try {
   await attachExistingFile(path);
  } catch {
   // ignore non-fatal picker errors
  }
 };

 const handleSubmit = (e?: React.FormEvent) => {
  e?.preventDefault();
  if (!message.trim() && attachments.length === 0) return;
  if (isLoading) return;

  onSend(message, attachments.length > 0 ? attachments : undefined);
  setMessage("");
  setAttachments([]);

  if (textareaRef.current) {
   textareaRef.current.style.height = "auto";
  }
 };

 const handleKeyDown = (e: React.KeyboardEvent) => {
  if (e.key === "Enter" && !e.shiftKey) {
   e.preventDefault();
   handleSubmit();
  }
 };

 const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
  const files = Array.from(e.target.files || []);
  setAttachments((prev) => [...prev, ...files]);
  if (fileInputRef.current) {
   fileInputRef.current.value = "";
  }
 };

 const removeAttachment = (index: number) => {
  setAttachments((prev) => prev.filter((_, i) => i !== index));
 };

 const toggleVoiceInput = () => {
  if (!recognitionRef.current) return;

  if (isListening) {
   recognitionRef.current.stop();
   setIsListening(false);
  } else {
   recognitionRef.current.start();
   setIsListening(true);
  }
 };

 const supportsVoice =
  typeof window !== "undefined" &&
  ("SpeechRecognition" in window || "webkitSpeechRecognition" in window);

 return (
  <div className="border-t border-border bg-card/80 backdrop-blur p-4">
   {/* Attachments preview */}
   {attachments.length > 0 && (
    <div className="flex flex-wrap gap-2 mb-3">
     {attachments.map((file, index) => (
      <div
       key={index}
       className="flex items-center gap-2 px-3 py-1.5 bg-muted rounded-xl text-sm border border-border"
      >
       <svg className="w-4 h-4 text-muted-foreground" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
       </svg>
       <span className="text-foreground max-w-[150px] truncate">{file.name}</span>
       <button
        onClick={() => removeAttachment(index)}
        className="text-muted-foreground hover:text-foreground"
       >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
         <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
        </svg>
       </button>
      </div>
     ))}
    </div>
   )}

   <form onSubmit={handleSubmit} className="relative flex items-end gap-3">
    {/* Attachment button */}
    <button
     type="button"
     onClick={() => fileInputRef.current?.click()}
     className="flex-shrink-0 p-2.5 text-muted-foreground hover:text-foreground hover:bg-primary rounded-xl transition-colors"
     title="Attach file"
    >
     <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15.172 7l-6.586 6.586a2 2 0 102.828 2.828l6.414-6.586a4 4 0 00-5.656-5.656l-6.415 6.585a6 6 0 108.486 8.486L20.5 13" />
     </svg>
    </button>
    <Input
     ref={fileInputRef}
     type="file"
     multiple
     className="hidden"
     onChange={handleFileSelect}
    />

    {/* Message input */}
    <div className="flex-1 relative">
     <Textarea
      ref={textareaRef}
      value={message}
      onChange={(e) => setMessage(e.target.value)}
      onKeyDown={handleKeyDown}
      placeholder={placeholder}
      rows={1}
      disabled={isLoading}
      className="w-full px-4 py-3 bg-muted border border-border rounded-2xl text-foreground placeholder-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring focus:border-transparent disabled:opacity-50 transition-all"
      style={{ minHeight: "48px", maxHeight: "200px" }}
     />

     {mentionQuery !== null && (
      <div className="absolute left-0 right-0 bottom-full mb-2 rounded-xl border border-border bg-card shadow-2xl max-h-56 overflow-y-auto z-20">
       <div className="px-3 py-2 text-xs text-muted-foreground border-b border-border">
        Attach from Files using @
       </div>

       {isLoadingFiles ? (
        <div className="px-3 py-3 text-sm text-muted-foreground">Loading files...</div>
       ) : filteredFiles.length === 0 ? (
        <div className="px-3 py-3 text-sm text-muted-foreground">No matching files</div>
       ) : (
        <div className="py-1">
         {filteredFiles.map((path) => (
          <button
           key={path}
           type="button"
           onClick={() => void handleMentionSelect(path)}
           className="w-full text-left px-3 py-2 hover:bg-primary transition-colors"
          >
           <div className="text-sm text-foreground truncate">{path.split("/").pop()}</div>
           <div className="text-[11px] text-muted-foreground truncate">{path}</div>
          </button>
         ))}
        </div>
       )}
      </div>
     )}
    </div>

    {/* Voice input button */}
    {supportsVoice && (
     <button
      type="button"
      onClick={toggleVoiceInput}
      className={`flex-shrink-0 p-2.5 rounded-xl transition-colors ${
       isListening
        ? "bg-red-500/20 text-red-400 hover:bg-red-500/30"
        : "text-muted-foreground hover:text-foreground hover:bg-primary"
      }`}
      title={isListening ? "Stop recording" : "Voice input"}
     >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path
        strokeLinecap="round"
        strokeLinejoin="round"
        strokeWidth={2}
        d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z"
       />
      </svg>
     </button>
    )}

    {/* Send/Stop button */}
    {isLoading ? (
     <button
      type="button"
      onClick={onStop}
      className="flex-shrink-0 p-2.5 bg-red-500/20 text-red-400 hover:bg-red-500/30 rounded-xl transition-colors"
      title="Stop generating"
     >
      <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 24 24">
       <rect x="6" y="6" width="12" height="12" rx="1" />
      </svg>
     </button>
    ) : (
     <button
      type="submit"
      disabled={!message.trim() && attachments.length === 0}
      className="flex-shrink-0 p-2.5 bg-primary hover:bg-primary/90 disabled:bg-muted disabled:text-muted-foreground text-primary-foreground rounded-xl transition-colors"
      title="Send message"
     >
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
       <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
      </svg>
     </button>
    )}
   </form>

   {/* Input hints */}
   <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
    <span>Enter to send, Shift+Enter newline, @ to attach from Files</span>
    {isListening && (
     <span className="flex items-center gap-1 text-red-400">
      <span className="w-2 h-2 bg-red-400 rounded-full animate-pulse" />
      Recording...
     </span>
    )}
   </div>
  </div>
 );
}
