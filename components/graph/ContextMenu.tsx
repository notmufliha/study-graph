"use client";

import { useEffect, useRef } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";

export type MenuItem =
  | { kind: "item"; label: string; icon?: IconName; onSelect: () => void; danger?: boolean; disabled?: boolean; hint?: string }
  | { kind: "separator" }
  | { kind: "custom"; render: () => React.ReactNode };

/** Right-click menu positioned in the graph container's coordinates. */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuItem[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("pointerdown", onDown, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      role="menu"
      style={{ left: x, top: y }}
      className="absolute z-50 min-w-48 rounded-lg border border-border bg-bg p-1 text-sm shadow-lg"
      onContextMenu={(e) => e.preventDefault()}
    >
      {items.map((item, i) => {
        if (item.kind === "separator") return <div key={i} className="my-1 h-px bg-border" />;
        if (item.kind === "custom") return <div key={i}>{item.render()}</div>;
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            title={item.hint}
            onClick={() => {
              onClose();
              item.onSelect();
            }}
            className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left disabled:cursor-not-allowed disabled:opacity-45 ${
              item.danger ? "text-danger hover:bg-danger/10" : "hover:bg-surface-2"
            }`}
          >
            {item.icon && <Icon name={item.icon} size={14} />}
            <span className="flex-1">{item.label}</span>
            {item.hint && <span className="text-xs text-muted">{item.hint}</span>}
          </button>
        );
      })}
    </div>
  );
}
