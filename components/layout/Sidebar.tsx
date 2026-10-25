"use client";

import Link from "next/link";
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Icon, type IconName } from "@/components/ui/Icon";
import { ThemeToggle } from "./ThemeToggle";
import { allTags, createNote, deleteNote, renameNote, searchNotes } from "@/lib/notes";
import { useUI } from "@/store/uiStore";
import type { Note } from "@/lib/types";

const nav: { href: string; label: string; icon: IconName }[] = [
  { href: "/", label: "All notes", icon: "note" },
  { href: "/graph", label: "Knowledge Graph", icon: "graph" },
  { href: "/settings", label: "Settings", icon: "settings" },
];

export function Sidebar() {
  const router = useRouter();
  const pathname = usePathname();
  const { search, setSearch, tagFilter, setTagFilter } = useUI();

  // useLiveQuery re-runs whenever the underlying IndexedDB tables change, so the
  // list stays in sync with edits made anywhere (editor, other tabs, imports).
  const notes = useLiveQuery(() => searchNotes(search, tagFilter), [search, tagFilter]);
  const tags = useLiveQuery(allTags, []);

  const onNew = async () => {
    const note = await createNote({ tags: tagFilter ? [tagFilter] : [] });
    router.push(`/notes/${note.id}`);
  };

  const onDelete = async (id: string) => {
    await deleteNote(id);
    if (pathname === `/notes/${id}`) router.push("/");
  };

  return (
    <aside className="flex h-full flex-col border-r border-border bg-surface">
      <div className="flex items-center justify-between px-4 pb-2 pt-4">
        <Link href="/" className="text-lg font-semibold tracking-tight">
          Study Graph
        </Link>
        <ThemeToggle />
      </div>

      <nav className="px-2">
        {nav.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm ${
              pathname === item.href ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            <Icon name={item.icon} />
            {item.label}
          </Link>
        ))}
      </nav>

      <div className="mt-3 space-y-2 px-3">
        <button
          onClick={onNew}
          className="flex w-full items-center justify-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90"
        >
          <Icon name="plus" /> New note
        </button>
        <label className="flex items-center gap-2 rounded-md border border-border bg-bg px-2 py-1.5 text-sm focus-within:border-accent">
          <Icon name="search" className="text-muted" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search notes & concepts"
            className="w-full bg-transparent outline-none placeholder:text-muted"
          />
          {search && (
            <button aria-label="Clear search" onClick={() => setSearch("")} className="text-muted hover:text-fg">
              <Icon name="x" size={14} />
            </button>
          )}
        </label>
      </div>

      {tags && tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1 px-3">
          {tags.map((tag) => (
            <button
              key={tag}
              onClick={() => setTagFilter(tagFilter === tag ? null : tag)}
              className={`rounded-full border px-2 py-0.5 text-xs ${
                tagFilter === tag
                  ? "border-accent bg-accent-soft text-accent"
                  : "border-border text-muted hover:text-fg"
              }`}
            >
              #{tag}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3 min-h-0 flex-1 overflow-y-auto px-2 pb-4">
        {notes?.length === 0 && (
          <p className="px-2 py-4 text-sm text-muted">{search || tagFilter ? "No matching notes." : "No notes yet."}</p>
        )}
        {notes?.map((note) => (
          <NoteItem
            key={note.id}
            note={note}
            active={pathname === `/notes/${note.id}`}
            onRename={(title) => renameNote(note.id, title)}
            onDelete={() => onDelete(note.id)}
          />
        ))}
      </div>
    </aside>
  );
}

function NoteItem({
  note,
  active,
  onRename,
  onDelete,
}: {
  note: Note;
  active: boolean;
  onRename: (title: string) => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [draft, setDraft] = useState(note.title);

  if (editing) {
    const commit = () => {
      onRename(draft);
      setEditing(false);
    };
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") commit();
          if (e.key === "Escape") setEditing(false);
        }}
        className="w-full rounded-md border border-accent bg-bg px-2 py-1.5 text-sm outline-none"
      />
    );
  }

  return (
    <div
      className={`group flex items-center rounded-md text-sm ${
        active ? "bg-accent-soft text-accent" : "hover:bg-surface-2"
      }`}
    >
      <Link
        href={`/notes/${note.id}`}
        className="min-w-0 flex-1 px-2 py-1.5"
        onDoubleClick={(e) => {
          e.preventDefault();
          setDraft(note.title);
          setEditing(true);
        }}
      >
        <div className="truncate">{note.title || "Untitled note"}</div>
        <div className="truncate text-xs text-muted">{new Date(note.updatedAt).toLocaleDateString()}</div>
      </Link>
      {/* Inline two-step confirm instead of window.confirm(), which blocks the page. */}
      {confirming ? (
        <div className="flex items-center gap-0.5 pr-1">
          <span className="text-xs text-danger">Delete?</span>
          <button aria-label="Confirm delete" onClick={onDelete} className="rounded p-1 text-danger hover:bg-surface">
            <Icon name="check" size={14} />
          </button>
          <button aria-label="Cancel delete" onClick={() => setConfirming(false)} className="rounded p-1 hover:bg-surface">
            <Icon name="x" size={14} />
          </button>
        </div>
      ) : (
        <div className="flex items-center gap-0.5 pr-1 opacity-0 group-focus-within:opacity-100 group-hover:opacity-100">
          <button
            aria-label="Rename note"
            onClick={() => {
              setDraft(note.title);
              setEditing(true);
            }}
            className="rounded p-1 text-muted hover:bg-surface hover:text-fg"
          >
            <Icon name="pencil" size={14} />
          </button>
          <button
            aria-label="Delete note"
            onClick={() => setConfirming(true)}
            className="rounded p-1 text-muted hover:bg-surface hover:text-danger"
          >
            <Icon name="trash" size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
