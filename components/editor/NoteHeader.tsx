"use client";

import { useState } from "react";
import { normalizeTag, renameNote, updateNote } from "@/lib/notes";
import type { Note } from "@/lib/types";

export function NoteHeader({ note, children }: { note: Note; children?: React.ReactNode }) {
  // Local state so typing isn't interrupted by the IndexedDB round-trip.
  const [title, setTitle] = useState(note.title);
  const [tagDraft, setTagDraft] = useState("");

  const addTag = () => {
    const tag = normalizeTag(tagDraft);
    setTagDraft("");
    if (tag && !note.tags.includes(tag)) void updateNote(note.id, { tags: [...note.tags, tag] });
  };
  const removeTag = (tag: string) => void updateNote(note.id, { tags: note.tags.filter((t) => t !== tag) });

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-border px-4 py-2">
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={() => renameNote(note.id, title)}
        onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()}
        aria-label="Note title"
        placeholder="Untitled note"
        className="min-w-40 flex-1 bg-transparent text-lg font-semibold outline-none"
      />
      <div className="flex flex-wrap items-center gap-1">
        {note.tags.map((tag) => (
          <span key={tag} className="flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-xs">
            #{tag}
            <button aria-label={`Remove tag ${tag}`} onClick={() => removeTag(tag)} className="text-muted hover:text-danger">
              ×
            </button>
          </span>
        ))}
        <input
          value={tagDraft}
          onChange={(e) => setTagDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              addTag();
            } else if (e.key === "Backspace" && !tagDraft && note.tags.length) {
              removeTag(note.tags[note.tags.length - 1]);
            }
          }}
          onBlur={addTag}
          placeholder="+ tag"
          aria-label="Add tag"
          className="w-16 bg-transparent text-xs outline-none placeholder:text-muted focus:w-28"
        />
      </div>
      {children}
    </div>
  );
}
