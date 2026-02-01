import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MyBot Admin",
  description: "AI Agent VPS Control Panel",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className="dark">
      <body className="bg-zinc-950 text-zinc-100 min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
