import { db } from "../db";
import { termsRegex } from "../graph/normalize";
import { blocksOf, parseDoc } from "../tiptap";
import { createProvider } from "./index";
import { explainMessages } from "./prompts";
import { chatJSONWithRetry, type AISettings } from "./provider";
import { ExplanationSchema, type Explanation } from "./schemas";

const MAX_CONTEXT = 3000;

/** "Ask AI to explain": uses the paragraphs that mention the concept, from every note it appears in. */
export async function explainConcept(
  conceptId: string,
  settings: AISettings,
  signal: AbortSignal,
): Promise<Explanation | null> {
  const c = await db.concepts.get(conceptId);
  if (!c) return null;
  const re = termsRegex([c.label, ...c.aliases]);
  const notes = await db.notes.bulkGet(c.noteIds);
  const context: string[] = [];
  let size = 0;
  for (const note of notes) {
    if (!note) continue;
    for (const b of blocksOf(parseDoc(note.content))) {
      re!.lastIndex = 0;
      if (!re!.test(b.text) || size + b.text.length > MAX_CONTEXT) continue;
      context.push(b.text);
      size += b.text.length;
    }
  }
  return chatJSONWithRetry(
    createProvider(settings),
    explainMessages({ label: c.label, noteTitle: notes[0]?.title, context: context.join("\n\n") }),
    ExplanationSchema,
    signal,
  );
}

/** Saving the AI's one-liner is the student's choice, so it counts as their edit. */
export async function saveSummary(conceptId: string, summary: string) {
  await db.concepts.update(conceptId, { summary });
}
