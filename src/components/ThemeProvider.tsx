"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider, type ThemeProviderProps, useTheme as useNextTheme } from "next-themes";

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
 return (
  <NextThemesProvider attribute="class" defaultTheme="dark" enableSystem={false} storageKey="overseer-theme" {...props}>
   {children}
  </NextThemesProvider>
 );
}

export const useTheme = useNextTheme;
