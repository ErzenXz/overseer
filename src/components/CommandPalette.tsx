"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Command } from "cmdk";
import {
  Bot,
  Settings,
  MessageSquare,
  Database,
  Shield,
  Users,
  Clock,
  Brain,
  Puzzle,
  BarChart3,
  RefreshCw,
  Moon,
  Sun,
  Home,
  Search,
  Zap,
  FileText,
} from "lucide-react";
import { Kbd } from "@/components/ui/kbd";
import { useTheme } from "@/components/ThemeProvider";

type CommandItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  shortcut?: string;
  action: () => void;
  group: string;
  keywords?: string[];
};

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();
  const { theme, setTheme } = useTheme();

  // Toggle open on ⌘K / Ctrl+K
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
      // Escape to close
      if (e.key === "Escape") {
        setOpen(false);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const navigate = useCallback(
    (path: string) => {
      setOpen(false);
      router.push(path);
    },
    [router]
  );

  const commands: CommandItem[] = [
    // Navigation
    {
      id: "nav-dashboard",
      label: "Go to Dashboard",
      icon: <Home className="h-4 w-4" />,
      action: () => navigate("/dashboard"),
      group: "Navigation",
      shortcut: "G D",
      keywords: ["home", "overview"],
    },
    {
      id: "nav-chat",
      label: "Go to Chat",
      icon: <MessageSquare className="h-4 w-4" />,
      action: () => navigate("/chat"),
      group: "Navigation",
      shortcut: "G C",
      keywords: ["conversation", "talk"],
    },
    {
      id: "nav-providers",
      label: "Go to Providers",
      icon: <Database className="h-4 w-4" />,
      action: () => navigate("/providers"),
      group: "Navigation",
      shortcut: "G P",
      keywords: ["llm", "model", "api"],
    },
    {
      id: "nav-settings",
      label: "Go to Settings",
      icon: <Settings className="h-4 w-4" />,
      action: () => navigate("/settings"),
      group: "Navigation",
      shortcut: "G S",
      keywords: ["config", "preferences"],
    },
    {
      id: "nav-users",
      label: "Go to Users",
      icon: <Users className="h-4 w-4" />,
      action: () => navigate("/users"),
      group: "Navigation",
      keywords: ["accounts", "team"],
    },
    {
      id: "nav-audit",
      label: "Go to Audit Log",
      icon: <Shield className="h-4 w-4" />,
      action: () => navigate("/audit"),
      group: "Navigation",
      keywords: ["security", "log"],
    },
    {
      id: "nav-cron",
      label: "Go to Cron Jobs",
      icon: <Clock className="h-4 w-4" />,
      action: () => navigate("/cron"),
      group: "Navigation",
      keywords: ["schedule", "automation"],
    },
    {
      id: "nav-skills",
      label: "Go to Skills",
      icon: <Puzzle className="h-4 w-4" />,
      action: () => navigate("/skills"),
      group: "Navigation",
      keywords: ["tools", "plugins"],
    },
    {
      id: "nav-memory",
      label: "Go to Memory",
      icon: <Brain className="h-4 w-4" />,
      action: () => navigate("/memory"),
      group: "Navigation",
      keywords: ["knowledge", "context"],
    },
    {
      id: "nav-analytics",
      label: "Go to Analytics",
      icon: <BarChart3 className="h-4 w-4" />,
      action: () => navigate("/analytics"),
      group: "Navigation",
      keywords: ["stats", "metrics"],
    },
    {
      id: "nav-interfaces",
      label: "Go to Interfaces",
      icon: <Bot className="h-4 w-4" />,
      action: () => navigate("/interfaces"),
      group: "Navigation",
      keywords: ["telegram", "discord", "slack"],
    },
    {
      id: "nav-tasks",
      label: "Go to Tasks",
      icon: <Zap className="h-4 w-4" />,
      action: () => navigate("/tasks"),
      group: "Navigation",
      keywords: ["agent", "jobs"],
    },
    {
      id: "nav-system",
      label: "Go to System",
      icon: <FileText className="h-4 w-4" />,
      action: () => navigate("/system"),
      group: "Navigation",
      keywords: ["update", "status"],
    },

    // Actions
    {
      id: "action-new-chat",
      label: "New Chat",
      icon: <MessageSquare className="h-4 w-4" />,
      action: () => navigate("/chat"),
      group: "Actions",
      shortcut: "N",
      keywords: ["create", "start"],
    },
    {
      id: "action-add-provider",
      label: "Add Provider",
      icon: <Database className="h-4 w-4" />,
      action: () => navigate("/providers"),
      group: "Actions",
      keywords: ["new", "create", "llm"],
    },
    {
      id: "action-toggle-theme",
      label: theme === "dark" ? "Switch to Light Mode" : "Switch to Dark Mode",
      icon: theme === "dark" ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />,
      action: () => {
        setTheme(theme === "dark" ? "light" : "dark");
        setOpen(false);
      },
      group: "Actions",
      shortcut: "T",
      keywords: ["theme", "appearance", "dark", "light"],
    },
    {
      id: "action-refresh",
      label: "Refresh Page",
      icon: <RefreshCw className="h-4 w-4" />,
      action: () => {
        setOpen(false);
        router.refresh();
      },
      group: "Actions",
      shortcut: "R",
    },
  ];

  const groups = [...new Set(commands.map((c) => c.group))];

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100]">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50 backdrop-blur-sm animate-in fade-in duration-150"
        onClick={() => setOpen(false)}
      />

      {/* Command dialog */}
      <div className="absolute left-1/2 top-[20%] -translate-x-1/2 w-full max-w-xl animate-in fade-in zoom-in-95 slide-in-from-top-2 duration-200">
        <Command
          className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-2xl overflow-hidden"
          loop
        >
          {/* Search input */}
          <div className="flex items-center gap-2 border-b border-[var(--color-border)] px-4">
            <Search className="h-4 w-4 shrink-0 text-[var(--color-text-muted)]" />
            <Command.Input
              placeholder="Type a command or search..."
              className="flex h-12 w-full bg-transparent text-sm text-white outline-none placeholder:text-[var(--color-text-muted)]"
            />
            <Kbd>ESC</Kbd>
          </div>

          {/* Results */}
          <Command.List className="max-h-80 overflow-y-auto p-2 custom-scrollbar">
            <Command.Empty className="py-8 text-center text-sm text-[var(--color-text-muted)]">
              No results found.
            </Command.Empty>

            {groups.map((group) => (
              <Command.Group
                key={group}
                heading={group}
                className="[&_[cmdk-group-heading]]:px-2 [&_[cmdk-group-heading]]:py-1.5 [&_[cmdk-group-heading]]:text-[10px] [&_[cmdk-group-heading]]:font-medium [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-[var(--color-text-muted)]"
              >
                {commands
                  .filter((c) => c.group === group)
                  .map((cmd) => (
                    <Command.Item
                      key={cmd.id}
                      value={`${cmd.label} ${cmd.keywords?.join(" ") ?? ""}`}
                      onSelect={cmd.action}
                      className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-[var(--color-text-secondary)] cursor-pointer transition-colors data-[selected=true]:bg-[var(--color-surface-overlay)] data-[selected=true]:text-white group"
                    >
                      <span className="text-[var(--color-text-muted)] group-data-[selected=true]:text-[var(--color-accent)]">
                        {cmd.icon}
                      </span>
                      <span className="flex-1">{cmd.label}</span>
                      {cmd.shortcut && (
                        <Kbd className="opacity-60 group-data-[selected=true]:opacity-100">
                          {cmd.shortcut}
                        </Kbd>
                      )}
                    </Command.Item>
                  ))}
              </Command.Group>
            ))}
          </Command.List>

          {/* Footer */}
          <div className="flex items-center justify-between border-t border-[var(--color-border)] px-4 py-2 text-[10px] text-[var(--color-text-muted)]">
            <div className="flex items-center gap-3">
              <span className="flex items-center gap-1">
                <Kbd>↑↓</Kbd> Navigate
              </span>
              <span className="flex items-center gap-1">
                <Kbd>↵</Kbd> Select
              </span>
              <span className="flex items-center gap-1">
                <Kbd>ESC</Kbd> Close
              </span>
            </div>
            <span className="flex items-center gap-1">
              <Kbd>⌘</Kbd><Kbd>K</Kbd> Toggle
            </span>
          </div>
        </Command>
      </div>
    </div>
  );
}
