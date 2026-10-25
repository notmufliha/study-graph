import { create } from "zustand";
import { persist } from "zustand/middleware";

export type Theme = "light" | "dark" | "system";

type UIState = {
  search: string;
  tagFilter: string | null;
  sidebarOpen: boolean; // mobile drawer
  theme: Theme;
  setSearch: (s: string) => void;
  setTagFilter: (t: string | null) => void;
  setSidebarOpen: (o: boolean) => void;
  setTheme: (t: Theme) => void;
};

export const useUI = create<UIState>()(
  persist(
    (set) => ({
      search: "",
      tagFilter: null,
      sidebarOpen: false,
      theme: "system",
      setSearch: (search) => set({ search }),
      setTagFilter: (tagFilter) => set({ tagFilter }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setTheme: (theme) => set({ theme }),
    }),
    // Only the theme is worth remembering across visits.
    { name: "study-graph-ui", partialize: (s) => ({ theme: s.theme }) },
  ),
);

/** Applies the theme class to <html>. Mirrors the inline script in app/layout.tsx. */
export function applyTheme(theme: Theme) {
  const dark =
    theme === "dark" || (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}
