import { Extension, type Editor } from "@tiptap/core";
import type { Node as PMNode } from "@tiptap/pm/model";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import { Decoration, DecorationSet } from "@tiptap/pm/view";

type State = { terms: string[]; deco: DecorationSet };

const key = new PluginKey<State>("conceptHighlight");

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Document ranges where any of `terms` appears as a whole word (plural "s"/"es" allowed), case-insensitive. */
export function findTermRanges(doc: PMNode, terms: string[]): { from: number; to: number }[] {
  const clean = [...new Set(terms.map((t) => t.trim()).filter((t) => t.length >= 2))].sort((a, b) => b.length - a.length);
  if (!clean.length) return [];
  const re = new RegExp(`(?<![\\p{L}\\p{N}])(?:${clean.map(escape).join("|")})(?:e?s)?(?![\\p{L}\\p{N}])`, "giu");
  const ranges: { from: number; to: number }[] = [];
  doc.descendants((node, pos) => {
    if (!node.isTextblock) return true;
    // Flatten the block's inline content into one string so a term split across
    // marks ("**page** table") still matches. Inline leaves count as one char,
    // which keeps string offsets equal to document offsets.
    let text = "";
    node.forEach((child) => {
      text += child.isText ? child.text : "￼";
    });
    for (const m of text.matchAll(re)) {
      ranges.push({ from: pos + 1 + m.index, to: pos + 1 + m.index + m[0].length });
    }
    return false;
  });
  return ranges;
}

function decorate(doc: PMNode, terms: string[]) {
  return DecorationSet.create(
    doc,
    findTermRanges(doc, terms).map((r) => Decoration.inline(r.from, r.to, { class: "concept-highlight" })),
  );
}

/** Highlights mentions of the concept selected in the graph (decorations only; the document is untouched). */
export const ConceptHighlight = Extension.create({
  name: "conceptHighlight",
  addProseMirrorPlugins() {
    return [
      new Plugin<State>({
        key,
        state: {
          init: () => ({ terms: [], deco: DecorationSet.empty }),
          apply(tr, prev, _old, state) {
            const next = tr.getMeta(key) as string[] | undefined;
            if (next === undefined && !tr.docChanged) return prev;
            const terms = next ?? prev.terms;
            return { terms, deco: terms.length ? decorate(state.doc, terms) : DecorationSet.empty };
          },
        },
        props: { decorations: (state) => key.getState(state)?.deco },
      }),
    ];
  },
});

export function setHighlightTerms(editor: Editor | null | undefined, terms: string[]) {
  if (!editor || editor.isDestroyed) return;
  editor.view.dispatch(editor.state.tr.setMeta(key, terms));
}

/** Selects and scrolls to the first mention. Returns false if the text never mentions it. */
export function jumpToTerms(editor: Editor | null | undefined, terms: string[]): boolean {
  if (!editor || editor.isDestroyed) return false;
  const [first] = findTermRanges(editor.state.doc, terms);
  if (!first) return false;
  setHighlightTerms(editor, terms);
  editor.chain().focus().setTextSelection(first).scrollIntoView().run();
  return true;
}
