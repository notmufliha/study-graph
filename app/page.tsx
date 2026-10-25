"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { Icon } from "@/components/ui/Icon";
import { createNote, searchNotes } from "@/lib/notes";
import { docText } from "@/lib/tiptap";
import { useUI } from "@/store/uiStore";

export default function HomePage() {
  const router = useRouter();
  const { search, tagFilter } = useUI();
  const notes = useLiveQuery(() => searchNotes(search, tagFilter), [search, tagFilter]);

  const onNew = async () => {
    const note = await createNote();
    router.push(`/notes/${note.id}`);
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-4 py-8 md:px-8">
        <div className="mb-6 flex items-center justify-between gap-4">
          <div>
            <h1 className="text-2xl font-semibold tracking-tight">All notes</h1>
            <p className="text-sm text-muted">
              {tagFilter ? `Tagged #${tagFilter}` : "Every note becomes a mind map as you type."}
              {search && ` · matching “${search}”`}
            </p>
          </div>
          <button
            onClick={onNew}
            className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-2 text-sm font-medium text-white hover:opacity-90"
          >
            <Icon name="plus" /> New note
          </button>
        </div>

        {notes === undefined ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : notes.length === 0 ? (
          <div className="rounded-lg border border-dashed border-border p-10 text-center text-muted">
            {search || tagFilter ? "No notes match." : "No notes yet. Create your first one!"}
          </div>
        ) : (
          <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {notes.map((n) => (
              <li key={n.id}>
                <Link
                  href={`/notes/${n.id}`}
                  className="block h-full rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent"
                >
                  <div className="truncate font-medium">{n.title || "Untitled note"}</div>
                  <p className="mt-1 line-clamp-3 text-sm text-muted">{docText(n.content) || "Empty note"}</p>
                  <div className="mt-3 flex flex-wrap items-center gap-1 text-xs text-muted">
                    {n.tags.map((t) => (
                      <span key={t} className="rounded-full bg-surface-2 px-2 py-0.5">
                        #{t}
                      </span>
                    ))}
                    <span className="ml-auto">{new Date(n.updatedAt).toLocaleString()}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
