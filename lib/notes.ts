import { db } from "./db";
import { newId } from "./id";
import { EMPTY_DOC, docText } from "./tiptap";
import type { Note } from "./types";

export async function createNote(partial: Partial<Note> = {}): Promise<Note> {
  const now = Date.now();
  const note: Note = {
    id: newId(),
    title: "Untitled note",
    content: JSON.stringify(EMPTY_DOC),
    tags: [],
    createdAt: now,
    updatedAt: now,
    ...partial,
  };
  await db.notes.add(note);
  return note;
}

export async function updateNote(id: string, changes: Partial<Omit<Note, "id" | "createdAt">>) {
  await db.notes.update(id, { ...changes, updatedAt: Date.now() });
}

export async function renameNote(id: string, title: string) {
  await updateNote(id, { title: title.trim() || "Untitled note" });
}

export function normalizeTag(tag: string) {
  return tag.trim().toLowerCase().replace(/^#/, "").replace(/\s+/g, "-");
}

/**
 * Deletes a note and everything that only existed because of it. Concepts are
 * shared between notes, so a concept is only removed when no other note
 * mentions it — otherwise we just drop this note from its noteIds.
 */
export async function deleteNote(id: string) {
  await db.transaction("rw", [db.notes, db.concepts, db.edges, db.layouts, db.deletions], async () => {
    await db.notes.delete(id);
    await db.edges.where("noteId").equals(id).delete();
    await db.layouts.where("noteId").equals(id).delete();
    await db.deletions.where("noteId").equals(id).delete();

    const orphanIds: string[] = [];
    await db.concepts
      .where("noteIds")
      .equals(id)
      .modify((c) => {
        c.noteIds = c.noteIds.filter((n) => n !== id);
        if (c.noteIds.length === 0) orphanIds.push(c.id);
      });
    if (orphanIds.length) {
      await db.concepts.bulkDelete(orphanIds);
      await db.edges.where("source").anyOf(orphanIds).delete();
      await db.edges.where("target").anyOf(orphanIds).delete();
      await db.layouts.where("conceptId").anyOf(orphanIds).delete();
    }
  });
}

/** Search across title, body text, tags and the labels/aliases of the note's concepts. */
export async function searchNotes(query: string, tag: string | null): Promise<Note[]> {
  let notes = await db.notes.orderBy("updatedAt").reverse().toArray();
  if (tag) notes = notes.filter((n) => n.tags.includes(tag));
  const q = query.trim().toLowerCase();
  if (!q) return notes;

  const conceptHits = new Set<string>();
  await db.concepts.each((c) => {
    if (c.label.includes(q) || c.aliases.some((a) => a.toLowerCase().includes(q))) {
      c.noteIds.forEach((n) => conceptHits.add(n));
    }
  });
  return notes.filter(
    (n) =>
      n.title.toLowerCase().includes(q) ||
      n.tags.some((t) => t.includes(q)) ||
      conceptHits.has(n.id) ||
      docText(n.content).toLowerCase().includes(q),
  );
}

export async function allTags(): Promise<string[]> {
  return (await db.notes.orderBy("tags").uniqueKeys()).map(String).sort();
}
