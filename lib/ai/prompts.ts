import type { ChatMessage } from "./provider";

export const EXTRACTION_SYSTEM_PROMPT =
  "You extract a study mind map from lecture notes. Return only concepts a student would need to learn (terms, definitions, processes, people, formulas) — not filler words. Use short noun-phrase labels in lowercase. Prefer connecting to EXISTING concepts over creating near-duplicates; if a new term is a synonym, add it as an alias. Every edge needs a specific relation verb (is a, part of, causes, requires, used for, example of, contrasts with, leads to). Do not invent facts not in the text.";

// Appended so the model knows how to use the incremental-ops format.
const OPS_INSTRUCTIONS = `Respond with JSON operations that UPDATE the existing map:
- addConcepts: only concepts that are new (not already in the existing list). Set "type" to term, process, person, formula or other, and give a one-line "summary".
- addEdges: connect every new concept to at least one other concept. "source" and "target" may be an existing concept id or the label of a concept you are adding. Write relations in plain words with spaces. Direction reads "source relation target", e.g. paging -> implements -> virtual memory.
- removeConceptIds: ids of existing concepts whose ONLY mentions were in the removed text. Leave it empty if unsure.
Return empty arrays when nothing needs to change.`;

export function extractionMessages(input: {
  title: string;
  changed: string[];
  removed: string[];
  existing: { id: string; label: string }[];
}): ChatMessage[] {
  const existing = input.existing.length
    ? input.existing.map((c) => `${c.id}: ${c.label}`).join("\n")
    : "(none yet)";
  const user = [
    `Note title: ${input.title}`,
    `Existing concepts in this note (id: label):\n${existing}`,
    `New or edited text:\n"""\n${input.changed.join("\n\n")}\n"""`,
    input.removed.length ? `Removed text:\n"""\n${input.removed.join("\n\n")}\n"""` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
  return [
    { role: "system", content: `${EXTRACTION_SYSTEM_PROMPT}\n\n${OPS_INSTRUCTIONS}` },
    { role: "user", content: user },
  ];
}

export function crossLinkMessages(input: {
  noteConcepts: { id: string; label: string }[];
  otherConcepts: { id: string; label: string }[];
}): ChatMessage[] {
  const list = (cs: { id: string; label: string }[]) => cs.map((c) => `${c.id}: ${c.label}`).join("\n");
  return [
    {
      role: "system",
      content:
        "You connect study concepts across different lecture notes. Only propose a link when a student would genuinely benefit from seeing the connection (one is a kind of, part of, prerequisite for, contrasts with or is used by the other). Use a specific relation verb. Never link two concepts that are just synonyms. Propose at most 10 links; fewer is better.",
    },
    {
      role: "user",
      content: `Concepts from THIS note (id: label):\n${list(input.noteConcepts)}\n\nConcepts from OTHER notes (id: label):\n${list(input.otherConcepts)}\n\nReturn links whose source is from this note and target from other notes.`,
    },
  ];
}

export function explainMessages(input: { label: string; noteTitle?: string; context: string }): ChatMessage[] {
  return [
    {
      role: "system",
      content:
        "You are a patient tutor. Explain the concept clearly for a student, using the student's notes as context. Keep it short, concrete and accurate; give a small example if it helps. Write plain text without Markdown. If the notes don't cover something, you may use general knowledge but stay correct.",
    },
    {
      role: "user",
      content: `Concept: ${input.label}\n${input.noteTitle ? `From the note: ${input.noteTitle}\n` : ""}Relevant notes:\n"""\n${input.context || "(no notes)"}\n"""`,
    },
  ];
}
