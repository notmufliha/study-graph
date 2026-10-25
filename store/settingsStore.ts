import { create } from "zustand";
import { persist } from "zustand/middleware";
import { DEFAULT_AI_SETTINGS, type AISettings } from "@/lib/ai/provider";

type SettingsState = AISettings & { update: (changes: Partial<AISettings>) => void };

// Persisted to localStorage: like the notes, settings never leave the browser.
export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...DEFAULT_AI_SETTINGS,
      update: (changes) => set(changes),
    }),
    { name: "study-graph-ai", version: 1 },
  ),
);

export function aiSettings(): AISettings {
  const s = useSettings.getState();
  return {
    enabled: s.enabled,
    provider: s.provider,
    ollamaUrl: s.ollamaUrl,
    ollamaModel: s.ollamaModel,
    openaiUrl: s.openaiUrl,
    openaiModel: s.openaiModel,
    openaiKey: s.openaiKey,
  };
}
