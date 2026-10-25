"use client";

import { useEditorState, type Editor } from "@tiptap/react";

type Btn = {
  label: string;
  title: string;
  active: (e: Editor) => boolean;
  run: (e: Editor) => void;
  className?: string;
};

const buttons: (Btn | "sep")[] = [
  { label: "B", title: "Bold (Ctrl+B)", className: "font-bold", active: (e) => e.isActive("bold"), run: (e) => e.chain().focus().toggleBold().run() },
  { label: "I", title: "Italic (Ctrl+I)", className: "italic", active: (e) => e.isActive("italic"), run: (e) => e.chain().focus().toggleItalic().run() },
  { label: "U", title: "Underline (Ctrl+U)", className: "underline", active: (e) => e.isActive("underline"), run: (e) => e.chain().focus().toggleUnderline().run() },
  { label: "S", title: "Strikethrough", className: "line-through", active: (e) => e.isActive("strike"), run: (e) => e.chain().focus().toggleStrike().run() },
  { label: "</>", title: "Inline code", className: "font-mono text-xs", active: (e) => e.isActive("code"), run: (e) => e.chain().focus().toggleCode().run() },
  "sep",
  { label: "H1", title: "Heading 1 (# )", active: (e) => e.isActive("heading", { level: 1 }), run: (e) => e.chain().focus().toggleHeading({ level: 1 }).run() },
  { label: "H2", title: "Heading 2 (## )", active: (e) => e.isActive("heading", { level: 2 }), run: (e) => e.chain().focus().toggleHeading({ level: 2 }).run() },
  { label: "H3", title: "Heading 3 (### )", active: (e) => e.isActive("heading", { level: 3 }), run: (e) => e.chain().focus().toggleHeading({ level: 3 }).run() },
  "sep",
  { label: "•", title: "Bullet list (- )", active: (e) => e.isActive("bulletList"), run: (e) => e.chain().focus().toggleBulletList().run() },
  { label: "1.", title: "Numbered list (1. )", active: (e) => e.isActive("orderedList"), run: (e) => e.chain().focus().toggleOrderedList().run() },
  { label: "❝", title: "Quote (> )", active: (e) => e.isActive("blockquote"), run: (e) => e.chain().focus().toggleBlockquote().run() },
  { label: "{ }", title: "Code block (```)", className: "font-mono text-xs", active: (e) => e.isActive("codeBlock"), run: (e) => e.chain().focus().toggleCodeBlock().run() },
  { label: "—", title: "Divider (---)", active: () => false, run: (e) => e.chain().focus().setHorizontalRule().run() },
  "sep",
  { label: "↶", title: "Undo (Ctrl+Z)", active: () => false, run: (e) => e.chain().focus().undo().run() },
  { label: "↷", title: "Redo (Ctrl+Shift+Z)", active: () => false, run: (e) => e.chain().focus().redo().run() },
];

export function EditorToolbar({ editor }: { editor: Editor | null }) {
  // useEditorState re-renders only when the selected values change, not on every keystroke.
  const active = useEditorState({
    editor,
    selector: ({ editor }) =>
      editor ? buttons.map((b) => (b === "sep" ? false : b.active(editor))) : [],
  });

  return (
    <div className="flex flex-wrap items-center gap-0.5 border-b border-border bg-bg px-3 py-1.5">
      {buttons.map((b, i) =>
        b === "sep" ? (
          <span key={i} className="mx-1 h-5 w-px bg-border" />
        ) : (
          <button
            key={b.title}
            type="button"
            title={b.title}
            aria-label={b.title}
            aria-pressed={active?.[i] ?? false}
            disabled={!editor}
            onMouseDown={(e) => e.preventDefault() /* keep the editor selection */}
            onClick={() => editor && b.run(editor)}
            className={`min-w-7 rounded px-1.5 py-1 text-sm disabled:opacity-40 ${b.className ?? ""} ${
              active?.[i] ? "bg-accent-soft text-accent" : "text-muted hover:bg-surface-2 hover:text-fg"
            }`}
          >
            {b.label}
          </button>
        ),
      )}
    </div>
  );
}
