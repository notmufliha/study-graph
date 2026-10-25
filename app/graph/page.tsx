"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { noteColorMap } from "@/lib/graph/colors";
import { GraphPanel } from "@/components/graph/GraphPanel";
import { Icon } from "@/components/ui/Icon";

export default function KnowledgeGraphPage() {
  const notes = useLiveQuery(() => db.notes.orderBy("title").toArray(), []);
  const stats = useLiveQuery(async () => {
    const edges = await db.edges.toArray();
    return {
      concepts: await db.concepts.count(),
      shared: await db.concepts.filter((c) => c.noteIds.length > 1).count(),
      cross: edges.filter((e) => !e.noteId && e.status === "accepted").length,
      suggested: edges.filter((e) => e.status === "suggested").length,
    };
  }, []);

  const [colorBy, setColorBy] = useState<"note" | "type">("note");
  const [tag, setTag] = useState<string | null>(null);
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [selected, setSelected] = useState<string | null>(null);

  const colors = useMemo(() => noteColorMap(notes ?? []), [notes]);
  const tags = useMemo(() => [...new Set((notes ?? []).flatMap((n) => n.tags))].sort(), [notes]);
  const visibleNotes = useMemo(
    () => (notes ?? []).filter((n) => (!tag || n.tags.includes(tag)) && !hidden.has(n.id)),
    [notes, tag, hidden],
  );
  // Memoized so the graph only re-filters when the selection actually changes.
  const noteFilter = useMemo(
    () => (!tag && hidden.size === 0 ? null : visibleNotes.map((n) => n.id)),
    [tag, hidden, visibleNotes],
  );

  const toggleNote = (id: string) =>
    setHidden((h) => {
      const next = new Set(h);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  return (
    <div className="flex h-full flex-col md:flex-row">
      <aside className="flex max-h-56 shrink-0 flex-col gap-4 overflow-y-auto border-b border-border p-4 text-sm md:max-h-none md:w-64 md:border-r md:border-b-0">
        <div>
          <h1 className="text-lg font-semibold tracking-tight">Knowledge Graph</h1>
          {stats && (
            <p className="mt-1 text-xs text-muted">
              {stats.concepts} concepts · {stats.shared} shared between notes · {stats.cross} cross-note links
              {stats.suggested ? ` · ${stats.suggested} suggested` : ""}
            </p>
          )}
        </div>

        <div>
          <Label>Color by</Label>
          <div className="flex rounded-md border border-border p-0.5">
            {(["note", "type"] as const).map((c) => (
              <button
                key={c}
                onClick={() => setColorBy(c)}
                className={`flex-1 rounded px-2 py-1 text-xs capitalize ${colorBy === c ? "bg-accent-soft text-accent" : "text-muted hover:text-fg"}`}
              >
                {c}
              </button>
            ))}
          </div>
        </div>

        {tags.length > 0 && (
          <div>
            <Label>Tag</Label>
            <div className="flex flex-wrap gap-1">
              {tags.map((t) => (
                <button
                  key={t}
                  onClick={() => setTag(tag === t ? null : t)}
                  className={`rounded-full border px-2 py-0.5 text-xs ${tag === t ? "border-accent bg-accent-soft text-accent" : "border-border text-muted hover:text-fg"}`}
                >
                  #{t}
                </button>
              ))}
            </div>
          </div>
        )}

        <div>
          <Label>Notes</Label>
          <ul className="space-y-0.5">
            {(notes ?? [])
              .filter((n) => !tag || n.tags.includes(tag))
              .map((n) => (
                <li key={n.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded px-1 py-0.5 hover:bg-surface-2">
                    <input type="checkbox" checked={!hidden.has(n.id)} onChange={() => toggleNote(n.id)} className="accent-[var(--accent)]" />
                    {colorBy === "note" && <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ background: colors.get(n.id) }} />}
                    <span className="truncate">{n.title}</span>
                  </label>
                </li>
              ))}
          </ul>
          {colorBy === "note" && (
            <p className="mt-2 flex items-center gap-2 text-xs text-muted">
              <span className="h-2.5 w-2.5 rounded-full bg-accent" /> in several notes
            </p>
          )}
        </div>
      </aside>

      <div className="relative min-h-0 flex-1">
        <GraphPanel view="global" exportName="knowledge-graph" colorBy={colorBy} noteFilter={noteFilter} onSelectConcept={setSelected} />
        {selected && <Backlinks conceptId={selected} onClose={() => setSelected(null)} />}
      </div>
    </div>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return <div className="mb-1.5 text-xs font-semibold tracking-wide text-muted uppercase">{children}</div>;
}

/** Which notes mention the selected concept, and what it connects to across notes. */
function Backlinks({ conceptId, onClose }: { conceptId: string; onClose: () => void }) {
  const info = useLiveQuery(async () => {
    const c = await db.concepts.get(conceptId);
    if (!c) return null;
    const notes = (await db.notes.bulkGet(c.noteIds)).filter((n) => !!n);
    const edges = await db.edges.where("source").equals(conceptId).or("target").equals(conceptId).toArray();
    const cross = edges.filter((e) => !e.noteId);
    const others = await db.concepts.bulkGet(cross.map((e) => (e.source === conceptId ? e.target : e.source)));
    return {
      c,
      notes: notes.map((n) => ({ id: n!.id, title: n!.title })),
      links: cross.map((e, i) => ({ id: e.id, relation: e.relation, outgoing: e.source === conceptId, other: others[i]?.label, status: e.status })),
    };
  }, [conceptId]);

  if (info === undefined) return null;
  return (
    <div className="absolute top-14 right-3 z-30 w-72 max-w-[calc(100%-1.5rem)] rounded-lg border border-border bg-bg p-4 text-sm shadow-lg">
      <div className="flex items-start gap-2">
        <h2 className="flex-1 font-semibold">{info ? info.c.label : "Concept deleted"}</h2>
        <button aria-label="Close" onClick={onClose} className="rounded p-1 text-muted hover:bg-surface-2">
          <Icon name="x" size={14} />
        </button>
      </div>
      {info && (
        <>
          {info.c.summary && <p className="mt-1 text-muted">{info.c.summary}</p>}
          {info.c.aliases.length > 0 && <p className="mt-1 text-xs text-muted">Also: {info.c.aliases.join(", ")}</p>}
          <div className="mt-3 mb-1 text-xs font-semibold tracking-wide text-muted uppercase">
            Mentioned in {info.notes.length} note{info.notes.length === 1 ? "" : "s"}
          </div>
          <ul className="space-y-0.5">
            {info.notes.map((n) => (
              <li key={n.id}>
                <Link href={`/notes/${n.id}`} className="flex items-center gap-2 rounded px-1 py-0.5 text-accent hover:bg-surface-2">
                  <Icon name="note" size={13} /> <span className="truncate">{n.title}</span>
                </Link>
              </li>
            ))}
          </ul>
          {info.links.length > 0 && (
            <>
              <div className="mt-3 mb-1 text-xs font-semibold tracking-wide text-muted uppercase">Cross-note links</div>
              <ul className="space-y-0.5 text-xs">
                {info.links.map((l) => (
                  <li key={l.id} className={l.status === "suggested" ? "text-muted italic" : ""}>
                    {l.outgoing ? `${l.relation} → ${l.other}` : `${l.other} → ${l.relation}`}
                    {l.status === "suggested" && " (suggested)"}
                  </li>
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </div>
  );
}
