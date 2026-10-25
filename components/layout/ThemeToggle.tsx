"use client";

import { Icon } from "@/components/ui/Icon";
import { useMounted } from "@/lib/useMounted";
import { useUI, type Theme } from "@/store/uiStore";

const order: Theme[] = ["system", "light", "dark"];
const icons = { system: "monitor", light: "sun", dark: "moon" } as const;

export function ThemeToggle() {
  const { theme, setTheme } = useUI();
  // The persisted theme is only known on the client; render a neutral icon on
  // the server pass to avoid a hydration mismatch.
  const current = useMounted() ? theme : "system";

  return (
    <button
      aria-label={`Theme: ${current}. Click to change.`}
      title={`Theme: ${current}`}
      onClick={() => setTheme(order[(order.indexOf(theme) + 1) % order.length])}
      className="rounded-md p-1.5 text-muted hover:bg-surface-2 hover:text-fg"
    >
      <Icon name={icons[current]} />
    </button>
  );
}
