"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { Editor } from "@tiptap/react";
import { runCrossLinks } from "@/lib/ai/crossLinks";
import { runExtraction } from "@/lib/ai/liveGraph";
import { UnreachableError } from "@/lib/ai/provider";
import { aiSettings, useSettings } from "@/store/settingsStore";

export type LiveStatus = "off" | "idle" | "thinking" | "updated" | "unreachable" | "error";

const DEBOUNCE_MS = 2500;

/**
 * Live mind-map updates: ~2.5 s after the student stops typing, send what
 * changed to the AI and merge the result. Typing again aborts any request in
 * flight (its answer would describe outdated text anyway).
 */
export function useLiveGraph(noteId: string, editor: Editor | null) {
  const enabled = useSettings((s) => s.enabled);
  const [status, setStatus] = useState<LiveStatus>("idle");
  const [detail, setDetail] = useState("");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inflight = useRef<AbortController | null>(null);

  const cancel = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    inflight.current?.abort();
    inflight.current = null;
  }, []);

  const run = useCallback(
    async (full: boolean) => {
      if (!editor || editor.isDestroyed) return;
      cancel();
      const ctrl = new AbortController();
      inflight.current = ctrl;
      setStatus("thinking");
      setDetail("");
      try {
        // A long paste is processed in chunks; keep going until it's all in.
        let res = await runExtraction(noteId, editor.getJSON(), aiSettings(), ctrl.signal, full);
        while (res.kind === "updated" && res.pending && !ctrl.signal.aborted) {
          res = await runExtraction(noteId, editor.getJSON(), aiSettings(), ctrl.signal);
        }
        if (ctrl.signal.aborted) return;
        if (res.kind === "updated") {
          let summary = res.added || res.removed ? `+${res.added}${res.removed ? ` −${res.removed}` : ""}` : "no changes";
          // Second, cheaper pass: suggest links to other notes' concepts.
          if (res.added || full) {
            setDetail("linking to other notes");
            const suggested = await runCrossLinks(noteId, aiSettings(), ctrl.signal);
            if (ctrl.signal.aborted) return;
            if (suggested) summary += `, ${suggested} suggestion${suggested > 1 ? "s" : ""}`;
          }
          setStatus("updated");
          setDetail(summary);
        } else if (res.kind === "skipped") {
          setStatus("error");
          setDetail("The model's answer was unusable; skipped");
        } else {
          setStatus("idle");
        }
      } catch (e) {
        if ((e as Error).name === "AbortError" || ctrl.signal.aborted) return;
        setStatus(e instanceof UnreachableError ? "unreachable" : "error");
        setDetail((e as Error).message);
      } finally {
        if (inflight.current === ctrl) inflight.current = null;
      }
    },
    [editor, noteId, cancel],
  );

  useEffect(() => {
    if (!editor || !enabled) return;
    const onUpdate = ({ transaction }: { transaction: { docChanged: boolean } }) => {
      if (!transaction.docChanged) return;
      cancel();
      timer.current = setTimeout(() => void run(false), DEBOUNCE_MS);
    };
    editor.on("update", onUpdate);
    return () => {
      editor.off("update", onUpdate);
      cancel();
    };
  }, [editor, enabled, run, cancel]);

  return { status: enabled ? status : ("off" as const), detail, analyzeAll: () => void run(true) };
}
