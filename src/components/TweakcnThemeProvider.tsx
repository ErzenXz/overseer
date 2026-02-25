"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { useTheme } from "@/components/ThemeProvider";

type ThemeMode = "light" | "dark";

type TweakcnThemeSummary = {
  name: string;
  title: string;
  description?: string;
};

type TweakcnThemePayload = {
  name: string;
  title?: string;
  cssVars?: {
    theme?: Record<string, string>;
    light?: Record<string, string>;
    dark?: Record<string, string>;
  };
};

type TweakcnThemeContextValue = {
  themes: TweakcnThemeSummary[];
  currentTheme: string;
  setCurrentTheme: (name: string) => void;
  isLoading: boolean;
};

const STORAGE_KEY = "overseer-tweakcn-theme";

const TweakcnThemeContext = createContext<TweakcnThemeContextValue>({
  themes: [],
  currentTheme: "default",
  setCurrentTheme: () => {},
  isLoading: true,
});

function toCssVariables(payload: TweakcnThemePayload, mode: ThemeMode): Record<string, string> {
  const globalVars = payload.cssVars?.theme ?? {};
  const modeVars = mode === "dark" ? payload.cssVars?.dark ?? {} : payload.cssVars?.light ?? {};
  return { ...globalVars, ...modeVars };
}

export function TweakcnThemeProvider({ children }: { children: React.ReactNode }) {
  const { resolvedTheme } = useTheme();
  const [themes, setThemes] = useState<TweakcnThemeSummary[]>([]);
  const [currentTheme, setCurrentThemeState] = useState("default");
  const [isLoading, setIsLoading] = useState(true);
  const appliedKeysRef = useRef<string[]>([]);
  const cacheRef = useRef<Record<string, TweakcnThemePayload>>({});

  const mode: ThemeMode = resolvedTheme === "dark" ? "dark" : "light";

  const clearAppliedVars = useCallback(() => {
    const root = document.documentElement;
    for (const key of appliedKeysRef.current) {
      root.style.removeProperty(`--${key}`);
    }
    appliedKeysRef.current = [];
  }, []);

  useEffect(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      setCurrentThemeState(stored);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    const loadThemes = async () => {
      try {
        const res = await fetch("/api/themes/tweakcn");
        if (!res.ok) throw new Error("Failed to load tweakcn theme registry");
        const data = (await res.json()) as { themes?: TweakcnThemeSummary[] };
        if (!cancelled) {
          setThemes(data.themes ?? []);
        }
      } catch {
        if (!cancelled) {
          setThemes([]);
        }
      } finally {
        if (!cancelled) {
          setIsLoading(false);
        }
      }
    };

    loadThemes();

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const applyTheme = async () => {
      const root = document.documentElement;

      clearAppliedVars();

      if (currentTheme === "default") {
        delete root.dataset.tweakcnTheme;
        return;
      }

      try {
        if (!cacheRef.current[currentTheme]) {
          const res = await fetch(`/api/themes/tweakcn/${encodeURIComponent(currentTheme)}`);
          if (!res.ok) throw new Error("Failed to load tweakcn theme");
          cacheRef.current[currentTheme] = (await res.json()) as TweakcnThemePayload;
        }

        if (cancelled) return;

        const payload = cacheRef.current[currentTheme];
        const cssVars = toCssVariables(payload, mode);

        for (const [key, value] of Object.entries(cssVars)) {
          root.style.setProperty(`--${key}`, String(value));
        }

        appliedKeysRef.current = Object.keys(cssVars);
        root.dataset.tweakcnTheme = currentTheme;
      } catch {
        delete root.dataset.tweakcnTheme;
      }
    };

    applyTheme();

    return () => {
      cancelled = true;
    };
  }, [clearAppliedVars, currentTheme, mode]);

  const setCurrentTheme = useCallback((name: string) => {
    setCurrentThemeState(name);
    localStorage.setItem(STORAGE_KEY, name);
  }, []);

  const value = useMemo(
    () => ({ themes, currentTheme, setCurrentTheme, isLoading }),
    [themes, currentTheme, setCurrentTheme, isLoading],
  );

  return <TweakcnThemeContext.Provider value={value}>{children}</TweakcnThemeContext.Provider>;
}

export function useTweakcnTheme() {
  return useContext(TweakcnThemeContext);
}
