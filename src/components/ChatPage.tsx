"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { useChat } from "@ai-sdk/react";
import { DefaultChatTransport } from "ai";
import {
 Conversation,
 ConversationContent,
 ConversationEmptyState,
 ConversationScrollButton,
} from "@/components/ai-elements/conversation";
import {
 Message,
 MessageActions,
 MessageAction,
 MessageContent,
 MessageResponse,
} from "@/components/ai-elements/message";
import {
 PromptInput,
 PromptInputBody,
 PromptInputFooter,
 PromptInputSubmit,
 PromptInputTextarea,
 PromptInputTools,
 PromptInputSelect,
 PromptInputSelectContent,
 PromptInputSelectItem,
 PromptInputSelectTrigger,
 PromptInputSelectValue,
 type PromptInputMessage,
} from "@/components/ai-elements/prompt-input";
import { Suggestion, Suggestions } from "@/components/ai-elements/suggestion";
import {
 CopyIcon,
 LayoutDashboardIcon,
 MoonIcon,
 PanelLeftCloseIcon,
 PanelLeftIcon,
 PlusIcon,
 RefreshCcwIcon,
 SettingsIcon,
 SparklesIcon,
 SunIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";

/* ── Types ── */
interface ProviderOption {
 id: number;
 displayName: string;
 model: string;
 isDefault: number | boolean;
}

const SUGGESTIONS = [
 "Explain how this server is set up",
 "Write a Python script to monitor disk usage",
 "Help me debug a networking issue",
 "What can you do?",
];

/* ── Main Chat Page ── */
export default function ChatPage() {
 const [text, setText] = useState("");
 const [sidebarOpen, setSidebarOpen] = useState(true);
 const [providers, setProviders] = useState<ProviderOption[]>([]);
 const [selectedProviderId, setSelectedProviderId] = useState<string>("");
 const { theme, setTheme } = useTheme();
 const isDark = theme === "dark";
 const toggleTheme = useCallback(() => {
  setTheme(isDark ? "light" : "dark");
 }, [isDark, setTheme]);

 const { messages, sendMessage, status, setMessages, regenerate } = useChat({
  transport: new DefaultChatTransport({
   api: "/api/webui/chat",
   body: { providerId: selectedProviderId ? Number(selectedProviderId) : undefined },
  }),
 });

 useEffect(() => {
  fetch("/api/chat")
   .then((r) => r.json())
   .then((data) => {
    if (data.providers) {
     setProviders(data.providers);
     const def = data.providers.find((p: ProviderOption) => p.isDefault);
     if (def) setSelectedProviderId(String(def.id));
    }
   })
   .catch(() => {});
 }, []);

 const handleSubmit = useCallback(
  (message: PromptInputMessage) => {
   if (!message.text.trim()) return;
   sendMessage({ text: message.text });
   setText("");
  },
  [sendMessage],
 );

 const handleSuggestion = useCallback(
  (suggestion: string) => {
   sendMessage({ text: suggestion });
  },
  [sendMessage],
 );

 const handleNewChat = useCallback(() => {
  setMessages([]);
  setText("");
 }, [setMessages]);

 const isGenerating = status === "streaming" || status === "submitted";

 return (
  <div className="flex h-screen overflow-hidden bg-background text-foreground">
   {/* ── Sidebar ── */}
   <aside
    className={cn(
     "flex flex-col shrink-0 border-r border-border bg-sidebar transition-[width] duration-200 ease-in-out",
     sidebarOpen ? "w-[260px]" : "w-0 overflow-hidden border-r-0",
    )}
   >
    {/* Header */}
    <div className="flex items-center justify-between px-3 py-3 border-b border-border">
     <div className="flex items-center gap-2">
      <div className="flex h-6 w-6 items-center justify-center rounded-lg bg-primary">
       <SparklesIcon className="h-3.5 w-3.5 text-primary-foreground" />
      </div>
      <span className="text-sm font-semibold tracking-tight">Overseer</span>
     </div>
     <Button
      variant="ghost"
      size="icon"
      className="h-7 w-7 text-muted-foreground hover:text-foreground"
      onClick={() => setSidebarOpen(false)}
     >
      <PanelLeftCloseIcon className="h-4 w-4" />
     </Button>
    </div>

    {/* New chat */}
    <div className="p-2">
     <Button
      variant="ghost"
      className="w-full justify-start gap-2 h-9 px-3 text-sm text-foreground/80 hover:bg-primary hover:text-foreground"
      onClick={handleNewChat}
     >
      <PlusIcon className="h-4 w-4" />
      New chat
     </Button>
    </div>

    {/* History */}
    <div className="flex-1 overflow-y-auto px-2 py-1">
     <p className="px-2 py-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
      Recent
     </p>
     <p className="px-2 py-1 text-xs text-muted-foreground/50">No history yet</p>
    </div>

    {/* Footer */}
    <div className="border-t border-border p-2 space-y-0.5">
     <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2.5 h-9 px-3 text-sm text-muted-foreground hover:text-foreground"
      onClick={toggleTheme}
     >
      {isDark ? (
       <SunIcon className="h-4 w-4" />
      ) : (
       <MoonIcon className="h-4 w-4" />
      )}
      {isDark ? "Light mode" : "Dark mode"}
     </Button>
     <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2.5 h-9 px-3 text-sm text-muted-foreground hover:text-foreground"
      asChild
     >
      <a href="/admin">
       <LayoutDashboardIcon className="h-4 w-4" />
       Admin panel
      </a>
     </Button>
     <Button
      variant="ghost"
      size="sm"
      className="w-full justify-start gap-2.5 h-9 px-3 text-sm text-muted-foreground hover:text-foreground"
      asChild
     >
      <a href="/admin/settings">
       <SettingsIcon className="h-4 w-4" />
       Settings
      </a>
     </Button>
    </div>
   </aside>

   {/* ── Main ── */}
   <main className="flex flex-1 flex-col min-w-0 overflow-hidden">
    {/* Top bar */}
    <header className="flex shrink-0 items-center gap-1.5 border-b border-border px-3 h-12">
     {!sidebarOpen && (
      <>
       <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={() => setSidebarOpen(true)}
       >
        <PanelLeftIcon className="h-4 w-4" />
       </Button>
       <Button
        variant="ghost"
        size="icon"
        className="h-8 w-8 text-muted-foreground hover:text-foreground"
        onClick={handleNewChat}
       >
        <PlusIcon className="h-4 w-4" />
       </Button>
      </>
     )}
     <div className="flex-1" />
     {sidebarOpen && (
      <Button
       variant="ghost"
       size="icon"
       className="h-8 w-8 text-muted-foreground hover:text-foreground"
       onClick={handleNewChat}
      >
       <PlusIcon className="h-4 w-4" />
      </Button>
     )}
    </header>

    {/* Chat + Input */}
    <div className="flex flex-1 flex-col overflow-hidden">
     {/* Conversation */}
     <Conversation className="flex-1">
      <ConversationContent className="mx-auto w-full max-w-3xl px-4 py-6">
       {messages.length === 0 ? (
        <ConversationEmptyState className="min-h-[60vh]">
         <div className="flex flex-col items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-primary/10">
           <SparklesIcon className="h-7 w-7 text-primary" />
          </div>
          <div className="text-center">
           <h2 className="text-2xl font-semibold text-foreground">
            How can I help you?
           </h2>
           <p className="mt-1.5 text-sm text-muted-foreground">
            Ask anything — coding, sysadmin, writing, and more.
           </p>
          </div>
          <Suggestions className="mt-2 max-w-xl">
           {SUGGESTIONS.map((s) => (
            <Suggestion key={s} suggestion={s} onClick={handleSuggestion} />
           ))}
          </Suggestions>
         </div>
        </ConversationEmptyState>
       ) : (
        messages.map((message, idx) => {
         const isLast = idx === messages.length - 1;
         return (
          <Fragment key={message.id}>
           {message.parts.map((part, i) => {
            if (part.type !== "text") return null;
            return (
             <Fragment key={`${message.id}-${i}`}>
              <Message from={message.role}>
               <MessageContent>
                <MessageResponse
                 caret="block"
                 isAnimating={message.role === "assistant" && isLast && isGenerating}
                >
                 {part.text}
                </MessageResponse>
               </MessageContent>
               {message.role === "assistant" && isLast && !isGenerating && (
                <MessageActions>
                 <MessageAction
                  label="Copy"
                  tooltip="Copy message"
                  onClick={() => navigator.clipboard.writeText(part.text)}
                 >
                  <CopyIcon className="h-3.5 w-3.5" />
                 </MessageAction>
                 <MessageAction
                  label="Regenerate"
                  tooltip="Regenerate response"
                  onClick={() => regenerate()}
                 >
                  <RefreshCcwIcon className="h-3.5 w-3.5" />
                 </MessageAction>
                </MessageActions>
               )}
              </Message>
             </Fragment>
            );
           })}
          </Fragment>
         );
        })
       )}
      </ConversationContent>
      <ConversationScrollButton />
     </Conversation>

     {/* Input */}
     <div className="shrink-0 px-4 pb-5 pt-2">
      <div className="mx-auto w-full max-w-3xl">
       <PromptInput
        onSubmit={handleSubmit}
        className="rounded-2xl border border-border bg-card shadow-md"
       >
        <PromptInputBody>
         <PromptInputTextarea
          value={text}
          onChange={(e) => setText(e.currentTarget.value)}
          placeholder="Message Overseer..."
          disabled={isGenerating}
         />
        </PromptInputBody>
        <PromptInputFooter className="px-3 pb-3 pt-0">
         <PromptInputTools>
          {providers.length > 0 && (
           <PromptInputSelect
            value={selectedProviderId}
            onValueChange={setSelectedProviderId}
           >
            <PromptInputSelectTrigger className="h-7 max-w-[200px] text-xs">
             <PromptInputSelectValue placeholder="Select model" />
            </PromptInputSelectTrigger>
            <PromptInputSelectContent>
             {providers.map((p) => (
              <PromptInputSelectItem key={p.id} value={String(p.id)}>
               <span className="font-medium">{p.displayName}</span>
               <span className="ml-1.5 font-mono text-[10px] text-muted-foreground">
                {p.model}
               </span>
              </PromptInputSelectItem>
             ))}
            </PromptInputSelectContent>
           </PromptInputSelect>
          )}
         </PromptInputTools>
         <PromptInputSubmit
          status={status}
          disabled={!text.trim() && !isGenerating}
         />
        </PromptInputFooter>
       </PromptInput>
       <p className="mt-2 text-center text-[11px] text-muted-foreground">
        Overseer can make mistakes. Verify important information.
       </p>
      </div>
     </div>
    </div>
   </main>
  </div>
 );
}
