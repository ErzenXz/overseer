import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { TweakcnThemeProvider } from "@/components/TweakcnThemeProvider";
import { TooltipProvider } from "@/components/ui/tooltip";

export const metadata: Metadata = {
  title: "Overseer",
  description: "AI Agent Control Panel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body className="min-h-screen antialiased font-sans">
        <ThemeProvider>
          <TweakcnThemeProvider>
            <TooltipProvider>{children}</TooltipProvider>
          </TweakcnThemeProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
