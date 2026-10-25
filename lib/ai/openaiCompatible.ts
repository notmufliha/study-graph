import { z } from "zod";
import { jsonSchemaFor } from "./schemas";
import { UnreachableError, parseJSON, type AIProvider, type ChatMessage } from "./provider";

const RouteResponse = z.union([
  z.object({ content: z.string() }),
  z.object({ models: z.array(z.string()) }),
  z.object({ error: z.string(), unreachable: z.boolean().optional() }),
]);

/**
 * OpenAI-compatible APIs (Ollama Cloud, Groq, OpenRouter, …). Calls go through
 * our own /api/ai route handler so an API key from the AI_API_KEY env var never
 * reaches the browser, and so we avoid those providers' CORS rules.
 */
export class OpenAICompatibleProvider implements AIProvider {
  constructor(
    private baseUrl: string,
    private model: string,
    private apiKey: string,
  ) {}

  private async call(body: Record<string, unknown>, signal?: AbortSignal) {
    let res: Response;
    try {
      res = await fetch("/api/ai", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl: this.baseUrl, apiKey: this.apiKey || undefined, ...body }),
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

  async chatJSON<S extends z.ZodType>(messages: ChatMessage[], schema: S, signal?: AbortSignal): Promise<z.infer<S>> {
    const data = await this.call({ action: "chat", model: this.model, messages, jsonSchema: jsonSchemaFor(schema) }, signal);
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
