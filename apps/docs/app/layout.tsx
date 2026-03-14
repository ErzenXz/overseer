import { RootProvider } from 'fumadocs-ui/provider/next';
import './global.css';
import { Fraunces, Manrope } from 'next/font/google';
import type { Metadata } from 'next';
import type { ReactNode } from 'react';

const body = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
});

const display = Fraunces({
  subsets: ['latin'],
  variable: '--font-display',
});

export const metadata: Metadata = {
  title: {
    default: 'Overseer Docs',
    template: '%s | Overseer Docs',
  },
  description: 'Documentation for Overseer, a self-hosted AI workspace.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_DOCS_URL || 'http://localhost:3000'),
};

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${body.variable} ${display.variable}`}
      suppressHydrationWarning
    >
      <body className="flex flex-col min-h-screen">
        <RootProvider>{children}</RootProvider>
      </body>
    </html>
  );
}
