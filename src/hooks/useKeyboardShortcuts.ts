"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

type ShortcutMap = Record<string, () => void>;

/**
 * Global keyboard shortcuts for the dashboard.
 * Two-key sequences (e.g. "g d") are supported via a prefix buffer.
 */
export function useKeyboardShortcuts() {
  const router = useRouter();

  useEffect(() => {
    let prefix = "";
    let prefixTimer: ReturnType<typeof setTimeout> | null = null;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if user is typing in an input/textarea/contenteditable
      const tag = (e.target as HTMLElement).tagName;
      const isEditable =
        tag === "INPUT" ||
        tag === "TEXTAREA" ||
        tag === "SELECT" ||
        (e.target as HTMLElement).isContentEditable;

      if (isEditable) return;

      // ⌘K / Ctrl+K is handled by CommandPalette directly
      if ((e.metaKey || e.ctrlKey) && e.key === "k") return;

      const key = e.key.toLowerCase();

      // Two-key sequences: g + <key>
      if (prefix === "g") {
        e.preventDefault();
        prefix = "";
        if (prefixTimer) clearTimeout(prefixTimer);

        const gRoutes: Record<string, string> = {
          d: "/dashboard",
          c: "/chat",
          p: "/providers",
          s: "/settings",
          u: "/users",
          a: "/audit",
          k: "/skills",
          m: "/memory",
          i: "/interfaces",
          t: "/tasks",
          y: "/system",
          n: "/analytics",
          r: "/cron",
        };

        if (gRoutes[key]) {
          router.push(gRoutes[key]);
        }
        return;
      }

      // Start prefix
      if (key === "g" && !e.metaKey && !e.ctrlKey && !e.altKey) {
        prefix = "g";
        prefixTimer = setTimeout(() => {
          prefix = "";
        }, 1000);
        return;
      }

      // Single-key shortcuts
      if (key === "n" && !e.metaKey && !e.ctrlKey) {
        router.push("/chat");
        return;
      }

      if (key === "r" && !e.metaKey && !e.ctrlKey) {
        router.refresh();
        return;
      }

      if (key === "/" && !e.metaKey && !e.ctrlKey) {
        // Focus search if there's a search input on the page
        const searchInput = document.querySelector<HTMLInputElement>(
          '[data-search-input]'
        );
        if (searchInput) {
          e.preventDefault();
          searchInput.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      if (prefixTimer) clearTimeout(prefixTimer);
    };
  }, [router]);
}
