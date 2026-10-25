"use client";

import { useEffect, useRef, useState } from "react";

/** Text field for in-place renaming. Enter or blur saves, Escape cancels. */
export function InlineInput({
  initial,
  onCommit,
  onCancel,
  className = "",
}: {
  initial: string;
  onCommit: (value: string) => void;
  onCancel: () => void;
  className?: string;
}) {
  const [value, setValue] = useState(initial);
  const input = useRef<HTMLInputElement>(null);

  // autoFocus alone fails for brand-new nodes: React Flow keeps a node
  // visibility:hidden until it has measured it, and hidden inputs can't take
  // focus. Retry for a few frames until the node is shown.
  useEffect(() => {
    let frame = 0;
    let tries = 0;
    const tryFocus = () => {
      const el = input.current;
      if (!el || document.activeElement === el) return;
      el.focus();
      if (document.activeElement === el) el.select();
      else if (tries++ < 20) frame = requestAnimationFrame(tryFocus);
    };
    tryFocus();
    return () => cancelAnimationFrame(frame);
  }, []);
  // Enter triggers both keydown and the blur that follows; only act once.
  const done = useRef(false);
  const finish = (commit: boolean) => {
    if (done.current) return;
    done.current = true;
    if (commit) onCommit(value);
    else onCancel();
  };

  return (
    <input
      ref={input}
      value={value}
      size={Math.max(6, value.length + 1)}
      onChange={(e) => setValue(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation(); // keep Backspace/Delete/Ctrl+Z away from the graph
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      onBlur={() => finish(true)}
      // nodrag/nopan/nowheel: let the student select text without moving the canvas.
      className={`nodrag nopan nowheel min-w-0 bg-transparent outline-none ${className}`}
    />
  );
}
