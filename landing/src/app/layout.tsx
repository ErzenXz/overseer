import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Overseer — Self-Hosted AI Agent Platform",
  description:
    "Deploy a powerful AI agent on your server. Chat via Telegram, Discord, or Web. Manage everything through a beautiful dashboard. 20+ LLM providers supported.",
  keywords: [
    "AI agent",
    "self-hosted",
    "VPS",
    "server management",
    "Telegram bot",
    "Discord bot",
    "LLM",
    "AI platform",
    "overseer",
  ],
  openGraph: {
    title: "Overseer — Self-Hosted AI Agent Platform",
    description:
      "Deploy a powerful AI agent on your server. Full control, total privacy, unlimited power.",
    url: "https://overseer.sh",
    siteName: "Overseer",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Overseer — Self-Hosted AI Agent Platform",
    description:
      "Deploy a powerful AI agent on your server. Full control, total privacy, unlimited power.",
  },
  metadataBase: new URL("https://overseer.sh"),
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          href="https://fonts.googleapis.com/css2?family=Geist:wght@300;400;500;600;700&family=Instrument+Serif:ital@0;1&family=Geist+Mono:wght@400;500&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="bg-dark antialiased">{children}</body>
    </html>
  );
}
