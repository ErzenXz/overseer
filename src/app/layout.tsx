import type { Metadata } from "next";
import "./globals.css";

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
    <html lang="en" className="dark">
      <head>
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Inter:wght@400;500;600&display=swap"
        />
      </head>
      <body className="bg-[var(--color-surface)] text-[var(--color-text-primary)] min-h-screen antialiased font-[var(--font-sans)] noise-bg">
        {children}
      </body>
    </html>
  );
}
