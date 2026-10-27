"use client";

import Link from "next/link";
import { Icon } from "@/components/ui/Icon";
import { useSettings } from "@/store/settingsStore";
import type { LiveStatus } from "./useLiveGraph";

const LOOK: Record<LiveStatus, { dot: string; label: string }> = {
  off: { dot: "bg-muted/50", label: "AI off" },
  idle: { dot: "bg-muted", label: "Idle" },
  thinking: { dot: "bg-accent animate-pulse", label: "Thinking…" },
  updated: { dot: "bg-emerald-500", label: "Updated" },
  unreachable: { dot: "bg-danger", label: "Ollama not reachable" },
  error: { dot: "bg-amber-500", label: "AI error" },
};

export function AIStatus({ status, detail, onAnalyze }: { status: LiveStatus; detail: string; onAnalyze: () => void }) {
  const provider = useSettings((s) => s.provider);
  const look = LOOK[status];
  const label = status === "unreachable" && provider !== "ollama" ? "AI provider not reachable" : look.label;
  return (
    <div className="flex min-w-0 items-center gap-2 text-xs text-muted" aria-live="polite">
      <span className={`h-2 w-2 shrink-0 rounded-full ${look.dot}`} />
      <span className="truncate" title={detail || undefined}>
        {label}
        {(status === "updated" || status === "thinking") && detail ? ` (${detail})` : ""}
      </span>
      {status === "unreachable" || status === "off" ? (
        <Link href="/settings" className="shrink-0 text-accent hover:underline">
          {status === "off" ? "Turn on" : "Fix"}
        </Link>
      ) : (
        <button
          onClick={onAnalyze}
          disabled={status === "thinking"}
          title="Re-read the whole note and update the map"
          className="flex shrink-0 items-center gap-1 rounded px-1 py-0.5 hover:bg-surface-2 hover:text-fg disabled:opacity-40"
        >
          <Icon name="sparkles" size={12} /> Analyze
        </button>
      )}
    </div>
  );
}
