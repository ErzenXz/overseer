"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AssistantRuntimeProvider, type ToolCallMessagePartProps } from "@assistant-ui/react";
import { useChatRuntime } from "@assistant-ui/react-ai-sdk";
import { DefaultChatTransport } from "ai";
import { Thread } from "@assistant-ui/react-ui";
import { makeMarkdownText } from "@assistant-ui/react-ui";
import {
  LayoutDashboardIcon,
  MoonIcon,
  PanelLeftCloseIcon,
  PanelLeftIcon,
  PlusIcon,
  SettingsIcon,
  SparklesIcon,
  SunIcon,
  MessageSquareIcon,
  Trash2Icon,
  SearchIcon,
  WrenchIcon,
  CheckCircle2Icon,
  Loader2Icon,
  AlertCircleIcon,
  ChevronDownIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { useTheme } from "@/components/ThemeProvider";
import { cn } from "@/lib/utils";

/* ── Types ── */
interface ProviderOption {
  id: number;
  displayName: string;
  model: string;
  isDefault: number | boolean;
}

interface ConversationItem {
  id: number;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

/* ── Markdown renderer with code block styling ── */
const MarkdownText = makeMarkdownText({
  className: "aui-md-root",
});

/* ── Tool call fallback component ── */
function ToolFallback({ toolName, args, result, status }: ToolCallMessagePartProps) {
  const [expanded, setExpanded] = useState(false);

  const isRunning = status?.type === "running";
  const isComplete = status?.type === "complete";
  const isIncomplete = status?.type === "incomplete";
  const isRequiresAction = status?.type === "requires-action";

  const statusIcon = (() => {
    if (isRunning) return <Loader2Icon className="h-3.5 w-3.5 animate-spin text-blue-500" />;
    if (isComplete) return <CheckCircle2Icon className="h-3.5 w-3.5 text-emerald-500" />;
    if (isIncomplete) return <AlertCircleIcon className="h-3.5 w-3.5 text-destructive" />;
    if (isRequiresAction) return <Loader2Icon className="h-3.5 w-3.5 text-amber-500" />;
    return <Loader2Icon className="h-3.5 w-3.5 animate-spin text-muted-foreground" />;
  })();

  const statusLabel = (() => {
    if (isRunning) return "Running...";
    if (isComplete) return "Completed";
    if (isIncomplete) return "Failed";
    if (isRequiresAction) return "Waiting";
    return "Pending";
  })();

  return (
    <div className="my-2 rounded-lg border border-border bg-muted/30 overflow-hidden">
      {/* Header */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-muted/50 transition-colors"
      >
        <WrenchIcon className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
        <span className="text-xs font-medium text-foreground truncate">
          {toolName}
        </span>
        <span className="flex items-center gap-1 ml-auto text-[10px] text-muted-foreground">
          {statusIcon}
          <span>{statusLabel}</span>
        </span>
        <ChevronDownIcon
          className={cn(
            "h-3.5 w-3.5 text-muted-foreground transition-transform",
            expanded && "rotate-180"
          )}
        />
      </button>

      {/* Details */}
      {expanded && (
        <div className="border-t border-border px-3 py-2 space-y-2">
          {args && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Arguments
              </p>
              <pre className="text-[11px] font-mono text-foreground/80 bg-muted rounded-md p-2 overflow-x-auto max-h-40">
                {typeof args === "string" ? args : JSON.stringify(args, null, 2)}
              </pre>
            </div>
          )}
          {result !== undefined && (
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Result
              </p>
              <pre className="text-[11px] font-mono text-foreground/80 bg-muted rounded-md p-2 overflow-x-auto max-h-40">
                {typeof result === "string"
                  ? result
                  : JSON.stringify(result, null, 2)}
              </pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/* ── Time grouping ── */
function groupConversations(convos: ConversationItem[]) {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const weekAgo = new Date(today.getTime() - 7 * 86400000);
  const monthAgo = new Date(today.getTime() - 30 * 86400000);

  const groups: { label: string; items: ConversationItem[] }[] = [
    { label: "Today", items: [] },
    { label: "Yesterday", items: [] },
    { label: "Previous 7 days", items: [] },
    { label: "Previous 30 days", items: [] },
    { label: "Older", items: [] },
  ];

  for (const c of convos) {
    const d = new Date(c.updatedAt);
    if (d >= today) groups[0].items.push(c);
    else if (d >= yesterday) groups[1].items.push(c);
    else if (d >= weekAgo) groups[2].items.push(c);
    else if (d >= monthAgo) groups[3].items.push(c);
    else groups[4].items.push(c);
  }

  return groups.filter((g) => g.items.length > 0);
}

/* ── Conversation Sidebar ── */
function ConversationSidebar({
  conversations,
  activeId,
  onSelect,
  onNew,
  onDelete,
  search,
  onSearchChange,
}: {
  conversations: ConversationItem[];
  activeId: number | null;
  onSelect: (id: number) => void;
  onNew: () => void;
  onDelete: (id: number) => void;
  search: string;
  onSearchChange: (v: string) => void;
}) {
  const filtered = useMemo(() => {
    if (!search.trim()) return conversations;
    const q = search.toLowerCase();
    return conversations.filter((c) => c.title.toLowerCase().includes(q));
  }, [conversations, search]);

  const groups = useMemo(() => groupConversations(filtered), [filtered]);

  return (
    <div className="flex flex-col h-full">
      {/* New chat */}
      <div className="p-2">
        <Button
          variant="ghost"
          className="w-full justify-start gap-2 h-9 px-3 text-sm text-foreground/80 hover:bg-accent hover:text-foreground"
          onClick={onNew}
        >
          <PlusIcon className="h-4 w-4" />
          New chat
        </Button>
      </div>

      {/* Search */}
      <div className="px-2 pb-2">
        <div className="relative">
          <SearchIcon className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search conversations..."
            className="h-8 pl-8 text-xs bg-muted/50 border-0 focus-visible:ring-1"
          />
        </div>
      </div>

      {/* Conversation list */}
      <div className="flex-1 overflow-y-auto px-2 custom-scrollbar">
        {groups.length === 0 && (
          <p className="px-3 py-8 text-center text-xs text-muted-foreground">
            {search ? "No matches" : "No conversations yet"}
          </p>
        )}
        {groups.map((group) => (
          <div key={group.label} className="mb-3">
            <p className="px-2 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((c) => (
                <div
                  key={c.id}
                  className={cn(
                    "group flex items-center gap-2 px-2.5 py-2 rounded-lg text-sm cursor-pointer transition-colors",
                    activeId === c.id
                      ? "bg-accent text-accent-foreground"
                      : "text-foreground/70 hover:bg-accent/50 hover:text-foreground"
                  )}
                  onClick={() => onSelect(c.id)}
                >
                  <MessageSquareIcon className="h-3.5 w-3.5 shrink-0 opacity-50" />
                  <span className="flex-1 truncate text-[13px]">{c.title}</span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDelete(c.id);
                    }}
                    className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-destructive/10 hover:text-destructive transition-opacity"
                  >
                    <Trash2Icon className="h-3 w-3" />
                  </button>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── Chat Thread (keyed per conversation) ── */
function ChatThread({
  selectedProviderId,
  conversationId,
  onConversationCreated,
}: {
  selectedProviderId: string;
  conversationId: number | null;
  onConversationCreated: () => void;
}) {
  const transport = useMemo(
    () =>
      new DefaultChatTransport({
        api: "/api/webui/chat",
        body: selectedProviderId
          ? { providerId: Number(selectedProviderId) }
          : undefined,
      }),
    [selectedProviderId]
  );

  const runtime = useChatRuntime({ transport });

  // Refresh conversation list after first message sent
  useEffect(() => {
    // Poll briefly after mount to catch new conversation creation
    const timer = setTimeout(onConversationCreated, 3000);
    return () => clearTimeout(timer);
  }, [onConversationCreated]);

  return (
    <AssistantRuntimeProvider runtime={runtime}>
      <Thread
        assistantAvatar={{ fallback: "O" }}
        welcome={{
          message: "How can I help you today?",
          suggestions: [
            { prompt: "Explain how this server is set up" },
            { prompt: "Write a Python script to monitor disk usage" },
            { prompt: "Help me debug a networking issue" },
            { prompt: "What can you do?" },
          ],
        }}
        assistantMessage={{
          allowCopy: true,
          allowReload: true,
          components: {
            Text: MarkdownText,
            ToolFallback: ToolFallback,
          },
        }}
        userMessage={{
          allowEdit: true,
        }}
        strings={{
          composer: {
            input: { placeholder: "Message Overseer..." },
            send: { tooltip: "Send message" },
          },
          assistantMessage: {
            reload: { tooltip: "Regenerate" },
            copy: { tooltip: "Copy to clipboard" },
          },
        }}
      />
    </AssistantRuntimeProvider>
  );
}

/* ── Main Chat Page ── */
export default function ChatPage() {
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [providers, setProviders] = useState<ProviderOption[]>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<string>("");
  const [conversations, setConversations] = useState<ConversationItem[]>([]);
  const [activeConversationId, setActiveConversationId] = useState<number | null>(null);
  const [search, setSearch] = useState("");
  const { theme, setTheme } = useTheme();
  const isDark = theme === "dark";
  const chatKeyRef = useRef(0);
  const [chatKey, setChatKey] = useState(0);

  const toggleTheme = useCallback(() => {
    setTheme(isDark ? "light" : "dark");
  }, [isDark, setTheme]);

  // Load providers
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

  // Load conversations
  const loadConversations = useCallback(() => {
    fetch("/api/conversations")
      .then((r) => r.json())
      .then((data) => {
        if (data.conversations) setConversations(data.conversations);
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    loadConversations();
  }, [loadConversations]);

  // Refresh conversations periodically
  useEffect(() => {
    const interval = setInterval(loadConversations, 20000);
    return () => clearInterval(interval);
  }, [loadConversations]);

  const handleNewChat = useCallback(() => {
    setActiveConversationId(null);
    chatKeyRef.current += 1;
    setChatKey(chatKeyRef.current);
  }, []);

  const handleSelectConversation = useCallback((id: number) => {
    setActiveConversationId(id);
    chatKeyRef.current += 1;
    setChatKey(chatKeyRef.current);
  }, []);

  const handleDeleteConversation = useCallback(
    async (id: number) => {
      try {
        await fetch(`/api/chat/${id}`, { method: "DELETE" });
        setConversations((prev) => prev.filter((c) => c.id !== id));
        if (activeConversationId === id) {
          handleNewChat();
        }
      } catch {
        // ignore
      }
    },
    [activeConversationId, handleNewChat]
  );

  const selectedProvider = providers.find(
    (p) => String(p.id) === selectedProviderId
  );

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      {/* ── Sidebar ── */}
      <aside
        className={cn(
          "flex flex-col shrink-0 border-r border-border bg-sidebar transition-[width] duration-200 ease-in-out",
          sidebarOpen ? "w-[280px]" : "w-0 overflow-hidden border-r-0"
        )}
      >
        {/* Sidebar header */}
        <div className="flex items-center justify-between px-3 py-3 border-b border-border">
          <div className="flex items-center gap-2">
            <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary">
              <SparklesIcon className="h-3.5 w-3.5 text-primary-foreground" />
            </div>
            <span className="text-sm font-semibold tracking-tight">
              Overseer
            </span>
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

        {/* Conversations */}
        <ConversationSidebar
          conversations={conversations}
          activeId={activeConversationId}
          onSelect={handleSelectConversation}
          onNew={handleNewChat}
          onDelete={handleDeleteConversation}
          search={search}
          onSearchChange={setSearch}
        />

        {/* Sidebar footer */}
        <div className="border-t border-border p-2 space-y-0.5">
          {/* Model selector */}
          {providers.length > 0 && (
            <div className="px-2 pb-1.5">
              <label className="block text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                Model
              </label>
              <NativeSelect
                value={selectedProviderId}
                onChange={(e) => {
                  setSelectedProviderId(e.target.value);
                  // Force re-mount of chat thread with new transport
                  chatKeyRef.current += 1;
                  setChatKey(chatKeyRef.current);
                }}
                className="h-8 text-xs"
              >
                {providers.map((p) => (
                  <option key={p.id} value={String(p.id)}>
                    {p.displayName} · {p.model}
                  </option>
                ))}
              </NativeSelect>
            </div>
          )}
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
          {selectedProvider && (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className="font-medium">{selectedProvider.displayName}</span>
              <span className="text-[10px] font-mono opacity-60">
                {selectedProvider.model}
              </span>
            </div>
          )}
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

        {/* Chat thread — keyed to force re-mount on conversation/model change */}
        <div className="flex-1 overflow-hidden" key={chatKey}>
          <ChatThread
            selectedProviderId={selectedProviderId}
            conversationId={activeConversationId}
            onConversationCreated={loadConversations}
          />
        </div>
      </main>
    </div>
  );
}
