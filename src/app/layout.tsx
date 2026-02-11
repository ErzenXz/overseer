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
      <body className="bg-[var(--color-surface)] text-[var(--color-text-primary)] min-h-screen antialiased font-[var(--font-sans)] noise-bg">
        {children}
      </body>
    </html>
  );
}
