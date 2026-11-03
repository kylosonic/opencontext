import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { FAVICON_DATA_URI } from "@/components/logo";
import "./globals.css";

/**
 * Self-hosted fonts via next/font (downloaded at build time, served locally —
 * no external font CDN at runtime).
 */
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "OpenContext — Give text-only AI agents eyes and ears",
  description:
    "OpenContext converts videos, screen recordings, and visual references into structured context that text-only LLMs and coding agents can understand.",
  icons: {
    icon: FAVICON_DATA_URI,
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0b0d" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} min-h-screen bg-canvas font-sans text-ink antialiased`}
      >
        <a
          href="#main"
          className="sr-only z-50 rounded-md bg-accent px-4 py-2 text-sm font-medium text-on-accent focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        {children}
      </body>
    </html>
  );
}
