import type { Metadata } from 'next';
import { IBM_Plex_Sans, IBM_Plex_Mono } from 'next/font/google';
import './globals.css';

const ibmPlexSans = IBM_Plex_Sans({
  subsets: ['latin'],
  weight: ['400', '500', '600', '700'],
  variable: '--font-sans',
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ['latin'],
  weight: ['400', '500'],
  variable: '--font-mono',
});

const siteUrl = 'https://console-logger.saktichourasia.dev';
const title = 'Console — Structured logging for browser & Node.js';
const description = 'Zero-dependency, TypeScript-first logging library with six numeric log levels, child loggers, beautiful ANSI terminal output, browser DevTools styling, and flexible transports. Works in browser and Node.js.';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title,
  description,
  keywords: [
    'pino',
    'pino alternative',
    'structured logging',
    'javascript logger',
    'typescript logger',
    'child logger',
    'ndjson',
    'log levels',
    'browser logging',
    'node logger',
    'konsole',
    'konsole-logger',
  ],
  authors: [{ name: 'Sakti Kumar Chourasia', url: 'https://saktichourasia.dev' }],
  creator: 'Sakti Kumar Chourasia',
  openGraph: {
    type: 'website',
    url: siteUrl,
    title,
    description,
    siteName: 'Console',
    locale: 'en_US',
  },
  twitter: {
    card: 'summary_large_image',
    title,
    description,
    creator: '@shakcho',
  },
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" className={`${ibmPlexSans.variable} ${ibmPlexMono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
