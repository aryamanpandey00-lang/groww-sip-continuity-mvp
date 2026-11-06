import type { Metadata } from "next";
import { BottomNav } from "@/components/layout/bottom-nav";
import { AppHeader } from "@/components/layout/app-header";
import "./globals.css";

export const metadata: Metadata = {
  title: "Groww SIP Continuity — Demo",
  description:
    "A Groww-inspired graduation project demo. Fictional investor, funds and values. No real account or transaction is connected.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-surface text-ink antialiased">
        <div className="flex min-h-dvh flex-col">
          <AppHeader />
          <div className="flex flex-1 flex-col">{children}</div>
          <BottomNav />
        </div>
      </body>
    </html>
  );
}
