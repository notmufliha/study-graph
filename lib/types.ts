export type Note = {
  id: string;
  title: string;
  content: string; // TipTap JSON, stringified
  createdAt: number;
  updatedAt: number;
  tags: string[];
};

export type Concept = {
  id: string;
  label: string; // normalized, e.g. "binary search tree"
  aliases: string[]; // "BST", "binary search trees"
  summary?: string; // one-line explanation
  noteIds: string[]; // notes that mention it -> this is what links notes together
  // Extra fields beyond the spec, needed for user-edit protection & coloring:
  origin?: "ai" | "user"; // "user" once the student created or renamed it
  type?: ConceptType;
};

export type ConceptType = "term" | "process" | "person" | "formula" | "other";

export type Edge = {
  id: string;
  source: string; // concept id
  target: string; // concept id
  relation: string; // "is a", "part of", "causes", ...
  noteId?: string; // note it came from (undefined = cross-note edge)
  origin: "ai" | "user";
  status: "accepted" | "suggested";
};

export type ViewId = string | "global"; // a note id, or the global graph

export type NodeLayout = {
  noteId: ViewId;
  conceptId: string;
  x: number;
  y: number;
  pinned: boolean;
};

/** Things the student deleted in a note; the AI must never re-add them there. */
export type Deletion = {
  id: string;
  noteId: string;
  kind: "concept" | "edge";
  key: string; // normalized label, or "sourceLabel|relation|targetLabel"
  createdAt: number;
};

/** Cross-note suggestion the student rejected; never suggested again. */
export type RejectedPair = {
  key: string; // sorted "conceptIdA|conceptIdB"
  createdAt: number;
};

export type Meta = { key: string; value: unknown };
