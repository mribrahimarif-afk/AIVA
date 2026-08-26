import type { Metadata } from "next";
import "./globals.css";
import { AppShell } from "@/components/layout/app-shell";
import { storageService } from "@/storage/storage.service";

export const metadata: Metadata = {
  title: "AIVA Studio",
  description: "Autonomous Intelligent Video Assembly & Asset Intelligence Engine",
};

// Ensures the global storage skeleton exists before any page renders.
// Idempotent and cheap (recursive mkdir checks), so running it on every
// request is safe and keeps initialization deterministic without relying
// on a separate startup hook.
let globalStorageReady: Promise<void> | undefined;

function ensureGlobalStorage(): Promise<void> {
  if (!globalStorageReady) {
    globalStorageReady = storageService.initializeGlobalStorage();
  }
  return globalStorageReady;
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  await ensureGlobalStorage();

  return (
    <html lang="en" className="dark">
      <body className="antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
