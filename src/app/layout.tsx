import type { Metadata, Viewport } from "next";
import "./globals.css";
import { SyncManager } from "@/components/SyncManager";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: { default: "Golf Trip OS", template: "%s · Golf Trip OS" },
  description: "Scoring, handicaps, games, side bets and settlement for golf trips.",
  applicationName: "Golf Trip OS",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "Golf Trip OS" },
};

export const viewport: Viewport = {
  themeColor: "#f3efe6",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col">
        <SyncManager />
        {children}
      </body>
    </html>
  );
}
