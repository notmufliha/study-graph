import type { JSONContent } from "@tiptap/core";

export const EMPTY_DOC: JSONContent = { type: "doc", content: [{ type: "paragraph" }] };

export function parseDoc(content: string): JSONContent {
  if (!content) return EMPTY_DOC;
  try {
    const doc = JSON.parse(content) as JSONContent;
    return doc && doc.type === "doc" ? doc : EMPTY_DOC;
  } catch {
    return EMPTY_DOC;
  }
}

/** Plain text of one node (inline text joined, nested blocks separated by newlines). */
export function nodeText(node: JSONContent): string {
  if (node.type === "text") return node.text ?? "";
  if (node.type === "hardBreak") return "\n";
  const children = node.content ?? [];
  const isInlineParent = children.every((c) => c.type === "text" || c.type === "hardBreak");
  return children.map(nodeText).join(isInlineParent ? "" : "\n");
}

/** Top-level blocks as plain text. Used for search, Markdown export and AI diffs. */
export function docBlocks(doc: JSONContent): string[] {
  return (doc.content ?? []).map(nodeText).filter((t) => t.trim().length > 0);
}

export function docText(content: string): string {
  return docBlocks(parseDoc(content)).join("\n");
}

// Tiny builders so seed / imported content can be written readably.
export const t = {
  doc: (...content: JSONContent[]): JSONContent => ({ type: "doc", content }),
  h: (level: 1 | 2 | 3, text: string): JSONContent => ({
    type: "heading",
    attrs: { level },
    content: [{ type: "text", text }],
  }),
  p: (...parts: (string | JSONContent)[]): JSONContent => ({
    type: "paragraph",
    content: parts.map((x) => (typeof x === "string" ? { type: "text", text: x } : x)),
  }),
  b: (text: string): JSONContent => ({ type: "text", text, marks: [{ type: "bold" }] }),
  code: (text: string): JSONContent => ({ type: "text", text, marks: [{ type: "code" }] }),
  ul: (...items: (string | JSONContent[])[]): JSONContent => ({
    type: "bulletList",
    content: items.map((item) => ({
      type: "listItem",
      content: [t.p(...(typeof item === "string" ? [item] : item))],
    })),
  }),
  codeBlock: (text: string, language?: string): JSONContent => ({
    type: "codeBlock",
    attrs: { language: language ?? null },
    content: [{ type: "text", text }],
  }),
};
