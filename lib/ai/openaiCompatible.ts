import { z } from "zod";
import { jsonSchemaFor } from "./schemas";
import { UnreachableError, parseJSON, type AIProvider, type ChatMessage } from "./provider";

const RouteResponse = z.union([
  z.object({ content: z.string() }),
  z.object({ models: z.array(z.string()) }),
  z.object({ error: z.string(), unreachable: z.boolean().optional() }),
]);

/** Either the site owner's built-in AI (configured on the server) or the user's own provider and key. */
export type RouteTarget = { builtin: true } | { baseUrl: string; model: string; apiKey: string };

/**
 * OpenAI-compatible APIs (Groq, OpenRouter, Ollama Cloud, …). Calls go through
 * our own /api/ai route handler so the server's AI_API_KEY never reaches the
 * browser, and so we avoid those providers' CORS rules.
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(private target: RouteTarget) {}

  private async call(body: Record<string, unknown>, signal?: AbortSignal) {
    let res: Response;
    try {
      res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...this.targetFields(), ...body }),
        signal,
      });
    } catch (e) {
      if ((e as Error).name === "AbortError") throw e;
      throw new UnreachableError("Can't reach this app's /api/ai route");
    }
    const parsed = RouteResponse.safeParse(await res.json().catch(() => null));
    if (!parsed.success) throw new Error(`Unexpected response from /api/ai (HTTP ${res.status})`);
    const data = parsed.data;
    if ("error" in data) throw data.unreachable ? new UnreachableError(data.error) : new Error(data.error);
    return data;
  }

  private targetFields() {
    const t = this.target;
    return "builtin" in t ? { builtin: true } : { baseUrl: t.baseUrl, apiKey: t.apiKey || undefined, model: t.model };
  }

  async chatJSON<S extends z.ZodType>(messages: ChatMessage[], schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
    const data = await this.call({ action: "chat", messages, jsonSchema: jsonSchemaFor(schema) }, signal);
    if (!("content" in data)) throw new Error("Unexpected response from /api/ai");
    return parseJSON(data.content, schema);
  }

  async listModels(): Promise<string[]> {
    const data = await this.call({ action: "models" });
    if (!("models" in data)) throw new Error("Unexpected response from /api/ai");
    return data.models;
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
