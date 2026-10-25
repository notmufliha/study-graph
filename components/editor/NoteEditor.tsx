"use client";

import { useCallback, useEffect, useRef } from "react";
import { EditorContent, useEditor, type Editor } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Placeholder } from "@tiptap/extensions";
import { EditorToolbar } from "./EditorToolbar";
import { updateNote } from "@/lib/notes";
import { parseDoc } from "@/lib/tiptap";

const SAVE_DELAY_MS = 500;

type Props = {
  noteId: string;
  initialContent: string;
  /** Exposes the editor so other parts of the page (graph panel) can read/highlight it. */
  onReady?: (editor: Editor | null) => void;
};

/**
 * The editor is uncontrolled: it gets the stored content once on mount and then
 * owns the document. Re-feeding it from IndexedDB on every save would reset the
 * cursor while the student types. The parent remounts it (key=noteId) when
 * switching notes.
 */
export function NoteEditor({ noteId, initialContent, onReady }: Props) {
  const pending = useRef<string | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable for the lifetime of the component: noteId never changes while mounted
  // (the parent remounts on note switch), so listeners can safely capture it.
  const flush = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    if (pending.current !== null) {
      void updateNote(noteId, { content: pending.current });
      pending.current = null;
    }
  }, [noteId]);

  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [1, 2, 3] },
        link: { openOnClick: false, autolink: true },
      }),
      Placeholder.configure({ placeholder: "Start typing your notes… (try # for a heading, - for a list)" }),
    ],
    content: parseDoc(initialContent),
    // Required with SSR: render the editor only on the client to avoid hydration mismatches.
    immediatelyRender: false,
    editorProps: {
      attributes: { class: "tiptap px-6 py-6 md:px-10 max-w-3xl mx-auto", spellcheck: "true" },
    },
    onUpdate: ({ editor }) => {
      pending.current = JSON.stringify(editor.getJSON());
      if (timer.current) clearTimeout(timer.current);
      timer.current = setTimeout(flush, SAVE_DELAY_MS);
    },
  });

  useEffect(() => {
    onReady?.(editor);
    return () => onReady?.(null);
  }, [editor, onReady]);

  // Never lose the last keystrokes: save on unmount (note switch) and tab close.
  useEffect(() => {
    window.addEventListener("beforeunload", flush);
    return () => {
      window.removeEventListener("beforeunload", flush);
      flush();
    };
  }, [flush]);

  return (
    <div className="flex h-full flex-col">
      <EditorToolbar editor={editor} />
      <div className="min-h-0 flex-1 overflow-y-auto" onClick={() => editor?.commands.focus()}>
        <EditorContent editor={editor} className="h-full" />
      </div>
    </div>
  );
}
