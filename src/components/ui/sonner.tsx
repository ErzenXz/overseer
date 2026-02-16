"use client";

import { Toaster as SonnerToaster } from "sonner";

export function Toaster() {
  return (
    <SonnerToaster
      position="bottom-right"
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex items-start gap-3 w-full rounded-lg border border-[var(--color-border)] bg-[var(--color-surface-raised)] p-4 shadow-lg text-sm text-[var(--color-text-primary)]",
          title: "font-medium text-white",
          description: "text-[var(--color-text-secondary)] text-xs mt-0.5",
          actionButton:
            "bg-[var(--color-accent)] text-black text-xs font-medium px-3 py-1.5 rounded hover:bg-[var(--color-accent-light)] transition-colors",
          cancelButton:
            "text-[var(--color-text-muted)] text-xs px-2 py-1 rounded hover:text-white transition-colors",
          success: "!border-green-500/30 !bg-green-500/5",
          error: "!border-red-500/30 !bg-red-500/5",
          warning: "!border-amber-500/30 !bg-amber-500/5",
          info: "!border-blue-500/30 !bg-blue-500/5",
        },
      }}
      theme="dark"
      richColors
    />
  );
}
