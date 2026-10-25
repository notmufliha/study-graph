import { z } from "zod";

/*
 * Every AI response is validated against one of these. The same schemas are
 * turned into JSON Schema (z.toJSONSchema) and sent to the model as the
 * structured-output format, so the model is constrained to the shape we check.
 * (zod-to-json-schema emits an empty schema for zod v4, hence the built-in.)
 */

export const CONCEPT_TYPES = ["term", "process", "person", "formula", "other"] as const;

export const GraphOpsSchema = z.object({
  addConcepts: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        aliases: z.array(z.string().max(80)).max(8).default([]),
        summary: z.string().max(240).default(""),
        type: z.enum(CONCEPT_TYPES).default("term"),
      }),
    )
    .max(40)
    .default([]),
  addEdges: z
    .array(
      z.object({
        source: z.string().min(1).describe("existing concept id, or the label of a concept"),
        target: z.string().min(1).describe("existing concept id, or the label of a concept"),
        relation: z.string().min(1).max(80),
      }),
    )
    .max(60)
    .default([]),
  removeConceptIds: z.array(z.string()).max(40).default([]),
});
export type GraphOps = z.infer<typeof GraphOpsSchema>;

export const CrossLinksSchema = z.object({
  links: z
    .array(
      z.object({
        source: z.string().min(1).describe("id of a concept from THIS note"),
        target: z.string().min(1).describe("id of a concept from another note"),
        relation: z.string().min(1).max(80),
      }),
    )
    .max(20)
    .default([]),
});
export type CrossLinks = z.infer<typeof CrossLinksSchema>;

export const ExplanationSchema = z.object({
  summary: z.string().min(1).max(240).describe("one-line definition"),
  explanation: z.string().min(1).max(1500).describe("2-4 short paragraphs for a student"),
});
export type Explanation = z.infer<typeof ExplanationSchema>;

/** JSON Schema for the model's `format` / `response_format`. */
export function jsonSchemaFor(schema: z.ZodType): Record<string, unknown> {
  // io: "input" so fields with defaults are optional for the model, matching what zod accepts.
  const out = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  delete out.$schema;
  return out;
}
