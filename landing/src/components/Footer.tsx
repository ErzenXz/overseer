"use client";

import Link from "next/link";
import { Github, BookOpen, MessageSquare, Shield } from "lucide-react";

const footerLinks = {
  Product: [
    { name: "Features", href: "#features" },
    { name: "Integrations", href: "#integrations" },
    { name: "Architecture", href: "#architecture" },
    { name: "Pricing", href: "#", badge: "Free" },
  ],
  Resources: [
    { name: "Documentation", href: "https://docs.overseer.sh" },
    { name: "API Reference", href: "https://docs.overseer.sh/api" },
    { name: "Quick Start", href: "https://docs.overseer.sh/quickstart" },
    { name: "FAQ", href: "https://docs.overseer.sh/faq" },
  ],
  Community: [
    {
      name: "GitHub",
      href: "https://github.com/ErzenXz/overseer",
    },
    {
      name: "Discord",
      href: "https://discord.gg/overseer",
    },
    {
      name: "Contributing",
      href: "https://github.com/ErzenXz/overseer/blob/main/CONTRIBUTING.md",
    },
    { name: "Issues", href: "https://github.com/ErzenXz/overseer/issues" },
  ],
  Legal: [
    {
      name: "MIT License",
      href: "https://github.com/ErzenXz/overseer/blob/main/LICENSE",
    },
    { name: "Security", href: "https://docs.overseer.sh/security" },
    { name: "Privacy", href: "#" },
  ],
};

export default function Footer() {
  return (
    <footer className="relative border-t border-dark-border pt-20 pb-10 px-6">
      <div className="mx-auto max-w-7xl">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-10 mb-16">
          {/* Brand column */}
          <div className="col-span-2 md:col-span-1">
            <Link href="/" className="flex items-center gap-2.5 mb-4">
              <div className="w-8 h-8 rounded-lg bg-linear-to-br from-accent to-warm flex items-center justify-center">
                <span className="text-dark font-bold text-sm font-display">
                  O
                </span>
              </div>
              <span className="text-lg font-semibold tracking-tight">
                overseer<span className="text-accent">.sh</span>
              </span>
            </Link>
            <p className="text-sm text-text-muted leading-relaxed mb-6">
              Self-hosted AI agent platform. Full control, total privacy, unlimited
              power.
            </p>
            <div className="flex items-center gap-3">
              <Link
                href="https://github.com/ErzenXz/overseer"
                target="_blank"
                className="w-9 h-9 rounded-lg bg-dark-card border border-dark-border flex items-center justify-center text-text-muted hover:text-text-primary hover:border-dark-border-hover transition-all duration-300"
              >
                <Github className="w-4 h-4" />
              </Link>
              <Link
                href="https://discord.gg/overseer"
                target="_blank"
                className="w-9 h-9 rounded-lg bg-dark-card border border-dark-border flex items-center justify-center text-text-muted hover:text-text-primary hover:border-dark-border-hover transition-all duration-300"
              >
                <MessageSquare className="w-4 h-4" />
              </Link>
              <Link
                href="https://docs.overseer.sh"
                target="_blank"
                className="w-9 h-9 rounded-lg bg-dark-card border border-dark-border flex items-center justify-center text-text-muted hover:text-text-primary hover:border-dark-border-hover transition-all duration-300"
              >
                <BookOpen className="w-4 h-4" />
              </Link>
              <Link
                href="https://docs.overseer.sh/security"
                target="_blank"
                className="w-9 h-9 rounded-lg bg-dark-card border border-dark-border flex items-center justify-center text-text-muted hover:text-text-primary hover:border-dark-border-hover transition-all duration-300"
              >
                <Shield className="w-4 h-4" />
              </Link>
            </div>
          </div>

          {/* Link columns */}
          {Object.entries(footerLinks).map(([category, links]) => (
            <div key={category}>
              <h3 className="text-sm font-semibold text-text-primary mb-4">
                {category}
              </h3>
              <ul className="space-y-2.5">
                {links.map((link) => (
                  <li key={link.name}>
                    <Link
                      href={link.href}
                      target={
                        link.href.startsWith("http") ? "_blank" : undefined
                      }
                      className="text-sm text-text-muted hover:text-text-secondary transition-colors duration-200 flex items-center gap-2"
                    >
                      {link.name}
                      {"badge" in link && (
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-green-500/10 text-green-400 font-mono">
                          {(link as { badge: string }).badge}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>

        {/* Bottom bar */}
        <div className="section-divider mb-6" />
        <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
          <p className="text-xs text-text-muted">
            &copy; {new Date().getFullYear()} Overseer. Open source under MIT
            License.
          </p>
          <p className="text-xs text-text-muted">
            Built with Next.js, Vercel AI SDK, and passion.
          </p>
        </div>
      </div>
    </footer>
  );
}
