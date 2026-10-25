import type { JSONContent } from "@tiptap/core";
import { z } from "zod";
import { db } from "./db";
import { parseDoc } from "./tiptap";
import type { Note } from "./types";

// ---------- Markdown ----------

function inline(nodes: JSONContent[] = []): string {
  return nodes
    .map((n) => {
      if (n.type === "hardBreak") return "  \n";
      if (n.type !== "text") return "";
      let text = n.text ?? "";
      const marks = n.marks ?? [];
      if (marks.some((m) => m.type === "code")) return `\`${text}\``;
      // Escape characters Markdown would otherwise interpret.
      text = text.replace(/([\\`*_[\]#<>])/g, "\\$1");
      for (const m of marks) {
        if (m.type === "bold") text = `**${text}**`;
        else if (m.type === "italic") text = `*${text}*`;
        else if (m.type === "strike") text = `~~${text}~~`;
        else if (m.type === "link") text = `[${text}](${String(m.attrs?.href ?? "")})`;
      }
      return text;
    })
    .join("");
}

function block(node: JSONContent): string {
  const children = node.content ?? [];
  switch (node.type) {
    case "heading":
      return `${"#".repeat(Number(node.attrs?.level ?? 1))} ${inline(children)}`;
    case "paragraph":
      return inline(children);
    case "bulletList":
    case "orderedList":
      return children
        .map((item, i) => {
          const marker = node.type === "bulletList" ? "- " : `${Number(node.attrs?.start ?? 1) + i}. `;
          // Continuation lines (nested lists, extra paragraphs) are indented under the marker.
          const body = (item.content ?? []).map(block).join("\n").replace(/\n/g, "\n   ");
          return marker + body;
        })
        .join("\n");
    case "codeBlock":
      return `\`\`\`${node.attrs?.language ?? ""}\n${children.map((c) => c.text ?? "").join("")}\n\`\`\``;
    case "blockquote":
      return children.map(block).join("\n\n").replace(/^/gm, "> ");
    case "horizontalRule":
      return "---";
    default:
      return inline(children);
  }
}

export function noteToMarkdown(note: Note): string {
  const doc = parseDoc(note.content);
  const blocks = (doc.content ?? []).map(block).filter((b) => b.trim());
  const first = doc.content?.[0];
  const hasTitle = first?.type === "heading" && first.attrs?.level === 1;
  // Title first (the note's own H1 if it has one), then tags, then the body.
  const title = hasTitle ? blocks.shift()! : `# ${note.title}`;
  const tags = note.tags.length ? [note.tags.map((t) => `#${t}`).join(" ")] : [];
  return [title, ...tags, ...blocks].join("\n\n") + "\n";
}

// ---------- JSON backup ----------

/*
 * Everything lives in this browser's IndexedDB, so a JSON backup is the
 * student's only way to move devices or recover from cleared site data.
 * Imports are validated with zod and merged by id: nothing is deleted, and
 * rows with the same id are replaced by the imported version.
 */

const NoteRow = z.object({
  id: z.string(),
  title: z.string(),
  content: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  tags: z.array(z.string()),
});
const ConceptRow = z.object({
  id: z.string(),
  label: z.string(),
  aliases: z.array(z.string()),
  summary: z.string().optional(),
  noteIds: z.array(z.string()),
  origin: z.enum(["ai", "user"]).optional(),
  type: z.enum(["term", "process", "person", "formula", "other"]).optional(),
});
const EdgeRow = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
  relation: z.string(),
  noteId: z.string().optional(),
  origin: z.enum(["ai", "user"]),
  status: z.enum(["accepted", "suggested"]),
});
const LayoutRow = z.object({ noteId: z.string(), conceptId: z.string(), x: z.number(), y: z.number(), pinned: z.boolean() });
const DeletionRow = z.object({
  id: z.string(),
  noteId: z.string(),
  kind: z.enum(["concept", "edge"]),
  key: z.string(),
  createdAt: z.number(),
});
const RejectedRow = z.object({ key: z.string(), createdAt: z.number() });

export const BackupSchema = z.object({
  app: z.literal("study-graph"),
  version: z.literal(1),
  exportedAt: z.string(),
  notes: z.array(NoteRow),
  concepts: z.array(ConceptRow),
  edges: z.array(EdgeRow),
  layouts: z.array(LayoutRow),
  deletions: z.array(DeletionRow).default([]),
  rejectedPairs: z.array(RejectedRow).default([]),
});
export type Backup = z.infer<typeof BackupSchema>;

export async function exportAll(): Promise<Backup> {
  return {
    app: "study-graph",
    version: 1,
    exportedAt: new Date().toISOString(),
    notes: await db.notes.toArray(),
    concepts: await db.concepts.toArray(),
    edges: await db.edges.toArray(),
    layouts: await db.layouts.toArray(),
    deletions: await db.deletions.toArray(),
    rejectedPairs: await db.rejectedPairs.toArray(),
  };
}

export type ImportResult = { notes: number; concepts: number; edges: number };

export async function importAll(json: string): Promise<ImportResult> {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const parsed = BackupSchema.safeParse(raw);
  if (!parsed.success) throw new Error("That file isn't a Study Graph backup (or it's damaged).");
  const b = parsed.data;

  await db.transaction("rw", [db.notes, db.concepts, db.edges, db.layouts, db.deletions, db.rejectedPairs, db.meta], async () => {
    // A concept that already exists here may be mentioned by local notes the
    // backup doesn't know about: union the note lists instead of replacing.
    const existing = new Map((await db.concepts.bulkGet(b.concepts.map((c) => c.id))).filter((c) => !!c).map((c) => [c!.id, c!]));
    const concepts = b.concepts.map((c) => {
      const here = existing.get(c.id);
      return here ? { ...c, noteIds: [...new Set([...here.noteIds, ...c.noteIds])] } : c;
    });
    await db.notes.bulkPut(b.notes);
    await db.concepts.bulkPut(concepts);
    await db.edges.bulkPut(b.edges);
    await db.layouts.bulkPut(b.layouts);
    await db.deletions.bulkPut(b.deletions);
    await db.rejectedPairs.bulkPut(b.rejectedPairs);
    // Imported notes haven't been seen by this browser's AI yet: forget any
    // stale diff state so the next edit re-reads them properly.
    await db.meta.bulkDelete(b.notes.flatMap((n) => [`ai:${n.id}`, `cross:${n.id}`]));
  });
  return { notes: b.notes.length, concepts: b.concepts.length, edges: b.edges.length };
}

// ---------- download helper ----------

export function downloadFile(filename: string, data: Blob | string, type = "text/plain") {
  const blob = typeof data === "string" ? new Blob([data], { type }) : data;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function slugify(s: string): string {
  return (
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "note"
  );
}
