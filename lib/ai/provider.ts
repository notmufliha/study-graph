import type { z } from "zod";

export type ChatMessage = { role: "system" | "user" | "assistant"; content: string };

/** Swappable AI backend. Every response is validated with the given zod schema. */
export interface AIProvider {
  chatJSON<S extends z.ZodType>(messages: ChatMessage[], schema: S, signal?: AbortSignal): Promise<z.infer<S>>;
  listModels(): Promise<string[]>;
  health(): Promise<boolean>;
}

export type ProviderKind = "ollama" | "openai";

export type AISettings = {
  enabled: boolean;
  provider: ProviderKind;
  ollamaUrl: string;
  ollamaModel: string;
  openaiUrl: string;
  openaiModel: string;
  /** User-supplied key; stays in this browser's localStorage, sent only to our /api/ai route. */
  openaiKey: string;
};

export const DEFAULT_AI_SETTINGS: AISettings = {
  enabled: true,
  provider: "ollama",
  ollamaUrl: "http://localhost:11434",
  ollamaModel: "qwen3:8b",
  openaiUrl: "https://ollama.com/v1",
  openaiModel: "",
  openaiKey: "",
};

/** The model answered, but not with JSON matching the schema. */
export class InvalidResponseError extends Error {
  constructor(message: string, readonly raw?: string) {
    super(message);
    this.name = "InvalidResponseError";
  }
}

/** Couldn't reach the AI at all (not running, CORS, network). */
export class UnreachableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnreachableError";
  }
}

/** Parses and validates a model's text reply. */
export function parseJSON<S extends z.ZodType>(text: string, schema: S): z.infer<S> {
  let data: unknown;
  try {
    // Some models still wrap JSON in ``` fences despite structured output.
    data = JSON.parse(text.replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ""));
  } catch {
    throw new InvalidResponseError("Response was not valid JSON", text);
  }
  const result = schema.safeParse(data);
  if (!result.success) throw new InvalidResponseError(`Response didn't match schema: ${result.error.message}`, text);
  return result.data;
}

/**
 * Spec'd retry policy: one retry on an invalid response, then give up quietly
 * (returns null). Network errors and aborts are re-thrown so the caller can
 * show "not reachable" or simply stop.
 */
export async function chatJSONWithRetry<S extends z.ZodType>(
  provider: AIProvider,
  messages: ChatMessage[],
  schema: S,
  signal?: AbortSignal,
): Promise<z.infer<S> | null> {
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      return await provider.chatJSON(messages, schema, signal);
    } catch (e) {
      if (!(e instanceof InvalidResponseError)) throw e;
      console.warn("AI returned an invalid response", attempt === 0 ? "(retrying)" : "(skipping)", e.message);
    }
  }
  return null;
}
