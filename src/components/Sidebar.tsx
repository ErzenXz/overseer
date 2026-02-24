"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { cn } from "@/lib/utils";
import { 
  MessageSquareIcon, LayoutDashboardIcon, BarChart2Icon, MessageCircleIcon, 
  FileTextIcon, ActivityIcon, CheckSquareIcon, FolderOpenIcon, ClockIcon, 
  NetworkIcon, ServerIcon, BoxesIcon, CloudIcon, LayoutTemplateIcon, 
  SparklesIcon, WrenchIcon, UsersIcon, SettingsIcon, LogOutIcon, 
  CommandIcon
} from "lucide-react";

interface User {
  username: string;
  role: string;
}

interface SidebarProps {
  user: User;
  permissions: string[];
}

interface NavItem {
  name: string;
  href: string;
  icon: React.ReactNode;
  badge?: string;
  requires?: string[];
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const navigationSections: NavSection[] = [
  {
    title: "",
    items: [
      {
        name: "Chat UI",
        href: "/",
        badge: "AI",
        requires: ["agent:execute"],
        icon: <MessageSquareIcon className="w-4 h-4" />,
      },
    ],
  },
  {
    title: "Monitor",
    items: [
      {
        name: "Dashboard",
        href: "/admin/dashboard",
        requires: ["agent:view"],
        icon: <LayoutDashboardIcon className="w-4 h-4" />,
      },
      {
        name: "Analytics",
        href: "/admin/analytics",
        requires: ["agent:view"],
        icon: <BarChart2Icon className="w-4 h-4" />,
      },
      {
        name: "Conversations",
        href: "/admin/conversations",
        requires: ["conversations:view"],
        icon: <MessageCircleIcon className="w-4 h-4" />,
      },
      {
        name: "Logs",
        href: "/admin/audit",
        requires: ["audit:view"],
        icon: <FileTextIcon className="w-4 h-4" />,
      },
    ],
  },
  {
    title: "Agent",
    items: [
      {
        name: "Sessions",
        href: "/admin/sessions",
        requires: ["agent:view"],
        icon: <ActivityIcon className="w-4 h-4" />,
      },
      {
        name: "Tasks",
        href: "/admin/tasks",
        requires: ["agent:view"],
        icon: <CheckSquareIcon className="w-4 h-4" />,
      },
      {
        name: "Files",
        href: "/admin/files",
        icon: <FolderOpenIcon className="w-4 h-4" />,
      },
      {
        name: "Cron Jobs",
        href: "/admin/cron",
        requires: ["agent:configure"],
        icon: <ClockIcon className="w-4 h-4" />,
      },
      {
        name: "Sub-agents",
        href: "/admin/subagents",
        requires: ["subagent:view"],
        icon: <NetworkIcon className="w-4 h-4" />,
      },
      {
        name: "MCP Servers",
        href: "/admin/mcp",
        requires: ["mcp:view"],
        icon: <ServerIcon className="w-4 h-4" />,
      },
      {
        name: "Skills",
        href: "/admin/skills",
        requires: ["skills:view"],
        icon: <BoxesIcon className="w-4 h-4" />,
      },
    ],
  },
  {
    title: "Config",
    items: [
      {
        name: "Providers",
        href: "/admin/providers",
        requires: ["providers:view"],
        icon: <CloudIcon className="w-4 h-4" />,
      },
      {
        name: "Interfaces",
        href: "/admin/interfaces",
        requires: ["interfaces:view"],
        icon: <LayoutTemplateIcon className="w-4 h-4" />,
      },
      {
        name: "Soul",
        href: "/admin/soul",
        requires: ["agent:configure"],
        icon: <SparklesIcon className="w-4 h-4" />,
      },
      {
        name: "Tools",
        href: "/admin/tools",
        requires: ["agent:configure"],
        icon: <WrenchIcon className="w-4 h-4" />,
      },
    ],
  },
  {
    title: "System",
    items: [
      {
        name: "Users",
        href: "/admin/users",
        requires: ["users:view"],
        icon: <UsersIcon className="w-4 h-4" />,
      },
      {
        name: "Settings",
        href: "/admin/settings",
        requires: ["system:settings:read"],
        icon: <SettingsIcon className="w-4 h-4" />,
      },
    ],
  },
];

export function Sidebar({ user, permissions }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();

  const canSee = (item: NavItem) => {
    if (!item.requires || item.requires.length === 0) return true;
    return item.requires.some((p) => permissions.includes(p));
  };

  const sections = navigationSections
    .map((section) => ({
      ...section,
      items: section.items.filter(canSee),
    }))
    .filter((section) => section.items.length > 0);

  const handleLogout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
    router.refresh();
  };

  return (
    <aside className="w-64 h-full bg-sidebar border-r border-border flex flex-col shrink-0">
      {/* Logo */}
      <div className="px-5 py-5 border-b border-border/50">
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-lg bg-primary flex items-center justify-center shadow-sm">
            <CommandIcon className="w-4 h-4 text-primary-foreground" />
          </div>
          <div>
            <h1 className="text-[15px] font-semibold tracking-tight text-foreground">Overseer</h1>
            <p className="text-[11px] font-mono text-muted-foreground mt-0.5">v1.0.0</p>
          </div>
        </div>
      </div>

      {/* Navigation */}
      <nav className="flex-1 py-4 px-3 overflow-y-auto custom-scrollbar">
        {sections.map((section, sectionIndex) => (
          <div key={section.title || `section-${sectionIndex}`} className={sectionIndex > 0 ? "mt-6" : ""}>
            {section.title && (
              <h3 className="px-3 mb-2 text-[11px] font-semibold text-muted-foreground uppercase tracking-wider">
                {section.title}
              </h3>
            )}
            <div className="space-y-1">
              {section.items.map((item) => {
                const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
                return (
                  <div key={item.name}>
                    <Link
                      href={item.href}
                      className={cn(
                        "flex items-center gap-3 px-3 py-2 rounded-md text-[13px] font-medium transition-all duration-200",
                        isActive
                          ? "bg-primary/10 text-primary"
                          : "text-sidebar-foreground/70 hover:text-sidebar-foreground hover:bg-sidebar-accent"
                      )}
                    >
                      <span className={cn("transition-colors", isActive ? "text-primary" : "text-sidebar-foreground/50")}>
                        {item.icon}
                      </span>
                      {item.name}
                      {item.badge && (
                        <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded bg-primary/10 text-primary font-semibold">
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      {/* User section */}
      <div className="p-4 border-t border-border/50 bg-sidebar-accent/30 m-3 rounded-xl">
        <div className="flex items-center gap-3 mb-3">
          <div className="w-8 h-8 rounded-full bg-background flex items-center justify-center border border-border shadow-sm">
            <span className="text-[13px] font-semibold text-foreground">
              {user.username.charAt(0).toUpperCase()}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-[13px] font-medium text-foreground truncate">{user.username}</p>
            <p className="text-[11px] text-muted-foreground capitalize">{user.role}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className="w-full flex items-center justify-center gap-2 px-3 py-2 text-[13px] font-medium text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-md transition-colors"
        >
          <LogOutIcon className="w-4 h-4" />
          Sign out
        </button>
      </div>
    </aside>
  );
}
