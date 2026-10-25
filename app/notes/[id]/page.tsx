"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "@/lib/db";
import { NoteWorkspace } from "@/components/editor/NoteWorkspace";

export default function NotePage() {
  const { id } = useParams<{ id: string }>();
  // `null` = loaded but missing; `undefined` = still loading.
  const note = useLiveQuery(async () => (await db.notes.get(id)) ?? null, [id]);

  if (note === undefined) return <div className="p-8 text-sm text-muted">Loading…</div>;
  if (note === null)
    return (
      <div className="p-8">
        <p className="text-muted">This note doesn&apos;t exist (it may have been deleted).</p>
        <Link href="/" className="mt-2 inline-block text-accent underline">
          Back to all notes
        </Link>
      </div>
    );

  // key=id remounts the editor when switching notes (it is uncontrolled).
  return <NoteWorkspace key={note.id} note={note} />;
}
