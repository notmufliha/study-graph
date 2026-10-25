import { z } from "zod";
import { jsonSchemaFor } from "./schemas";
import { UnreachableError, parseJSON, type AIProvider, type ChatMessage } from "./provider";

const ChatResponse = z.object({ message: z.object({ content: z.string() }) });
const TagsResponse = z.object({ models: z.array(z.object({ name: z.string() })) });
const ErrorResponse = z.object({ error: z.string() });

/**
 * Talks to Ollama straight from the student's browser. This is what makes the
 * Vercel-hosted site work with a local Ollama: Vercel's servers can't reach the
 * student's localhost, but their browser can (given OLLAMA_ORIGINS allows the site).
 */
export class OllamaBrowserProvider implements AIProvider {
  // Reasoning models (qwen3, deepseek-r1…) are much slower with thinking on.
  // Older Ollama versions or some models reject the flag, so we drop it once if refused.
  private sendThink = true;

  constructor(
    private baseUrl: string,
    private model: string,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, "");
  }

  private async request(path: string, init?: RequestInit): Promise<Response> {
    try {
      return await fetch(`${this.baseUrl}${path}`, init);
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      // fetch only rejects on network/CORS failures, never on HTTP status.
      throw new UnreachableError(`Can't reach Ollama at ${this.baseUrl}`);
    }
  }

  async chatJSON<S extends z.ZodType>(messages: ChatMessage[], schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
    const body = {
      model: this.model,
      messages,
      format: jsonSchemaFor(schema),
      stream: false,
      options: { temperature: 0.2 },
      ...(this.sendThink ? { think: false } : {}),
    };
    const res = await this.request("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal,
    });
    if (!res.ok) {
      const err = ErrorResponse.safeParse(await res.json().catch(() => null));
      const msg = err.success ? err.data.error : `HTTP ${res.status}`;
      if (this.sendThink && /think/i.test(msg)) {
        this.sendThink = false;
        return this.chatJSON(messages, schema, signal);
      }
      throw new Error(`Ollama error: ${msg}`);
    }
    const parsed = ChatResponse.safeParse(await res.json());
    if (!parsed.success) throw new Error("Unexpected response from Ollama");
    return parseJSON(parsed.data.message.content, schema);
  }

  async listModels(): Promise<string[]> {
    const res = await this.request("/api/tags");
    if (!res.ok) throw new Error(`Ollama error: HTTP ${res.status}`);
    const parsed = TagsResponse.safeParse(await res.json());
    if (!parsed.success) throw new Error("Unexpected response from Ollama");
    return parsed.data.models.map((m) => m.name).sort();
  }

  async health(): Promise<boolean> {
    try {
      await this.listModels();
      return true;
    } catch {
      return false;
    }
  }
}
