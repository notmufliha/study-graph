"use client";

import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { Sidebar } from "./Sidebar";
import { Icon } from "@/components/ui/Icon";
import { applyTheme, useUI } from "@/store/uiStore";
import { seedIfNeeded } from "@/lib/seed";

export function AppShell({ children }: { children: React.ReactNode }) {
  const theme = useUI((s) => s.theme);
  const sidebarOpen = useUI((s) => s.sidebarOpen);
  const setSidebarOpen = useUI((s) => s.setSidebarOpen);
  const pathname = usePathname();

  useEffect(() => {
    seedIfNeeded().catch((e) => console.error("Seeding failed", e));
  }, []);

  useEffect(() => {
    applyTheme(theme);
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

  // Close the mobile drawer after navigating.
  useEffect(() => setSidebarOpen(false), [pathname, setSidebarOpen]);

  return (
    <div className="flex h-full">
      {/* Desktop: static column. Mobile: slide-in drawer. */}
      <div
        className={`fixed inset-y-0 left-0 z-40 w-72 transform transition-transform md:static md:translate-x-0 ${
          sidebarOpen ? "translate-x-0" : "-translate-x-full"
        }`}
      >
        <Sidebar />
      </div>
      {sidebarOpen && (
        <button
          aria-label="Close sidebar"
          className="fixed inset-0 z-30 bg-black/40 md:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <main className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 border-b border-border px-3 py-2 md:hidden">
          <button
            aria-label="Open sidebar"
            className="rounded p-1.5 hover:bg-surface-2"
            onClick={() => setSidebarOpen(true)}
          >
            <Icon name="menu" />
          </button>
          <span className="font-semibold">Study Graph</span>
        </div>
        <div className="min-h-0 flex-1">{children}</div>
      </main>
    </div>
  );
}
