"use client";

import { QueryProvider } from "@/components/QueryProvider";
import { Toaster } from "@/components/ui/sonner";
import { CommandPalette } from "@/components/CommandPalette";
import { useKeyboardShortcuts } from "@/hooks/useKeyboardShortcuts";

function ShortcutsRoot({ children }: { children: React.ReactNode }) {
 useKeyboardShortcuts();
 return <>{children}</>;
}

export function DashboardShell({ children }: { children: React.ReactNode }) {
 return (
  <QueryProvider>
   <ShortcutsRoot>
    {children}
    <CommandPalette />
    <Toaster />
   </ShortcutsRoot>
  </QueryProvider>
 );
}
