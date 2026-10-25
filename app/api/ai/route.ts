import { z } from "zod";

// Proxy for OpenAI-compatible providers (see lib/ai/openaiCompatible.ts).
// The local-Ollama path never touches this route: the browser calls Ollama directly.

const Message = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(60_000) });

const Body = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("chat"),
    baseUrl: z.string().url(),
    apiKey: z.string().optional(),
    model: z.string().min(1),
    messages: z.array(Message).min(1).max(20),
    jsonSchema: z.record(z.string(), z.unknown()),
  }),
  z.object({ action: z.literal("models"), baseUrl: z.string().url(), apiKey: z.string().optional() }),
]);

const Completion = z.object({ choices: z.array(z.object({ message: z.object({ content: z.string().nullable() }) })).min(1) });
const Models = z.object({ data: z.array(z.object({ id: z.string() })) });

/**
 * This route makes server-side requests to a URL the client chooses, so it
 * must not become a way to reach private networks from the server. Only
 * public https hosts are allowed.
 */
function isAllowedTarget(raw: string): boolean {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }
  if (url.protocol !== "https:") return false;
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal") || host.endsWith(".local")) return false;
  if (/^\d+\.\d+\.\d+\.\d+$/.test(host)) {
    const [a, b] = host.split(".").map(Number);
    if (a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127))
      return false;
  }
  if (host.includes(":")) return false; // IPv6 literals: simplest safe answer is no
  return true;
}

const json = (data: unknown, status = 200) => Response.json(data, { status });

export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return json({ error: "Invalid request" }, 400);
  const body = parsed.data;

  if (!isAllowedTarget(body.baseUrl)) {
    return json({ error: "Base URL must be a public https:// address. For a local Ollama, choose the Ollama provider." }, 400);
  }
  const key = body.apiKey || process.env.AI_API_KEY;
  if (!key) return json({ error: "No API key: enter one in Settings or set AI_API_KEY on the server." }, 400);

  const base = body.baseUrl.replace(/\/+$/, "");
  const headers = { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };

  const upstream = async (path: string, init?: RequestInit) => {
    try {
      return await fetch(`${base}${path}`, { ...init, headers, signal: request.signal });
    } catch {
      return null;
    }
  };
  const upstreamError = async (res: Response) => {
    const text = (await res.text()).slice(0, 300);
    return json({ error: `Provider returned HTTP ${res.status}: ${text}` }, 502);
  };

  if (body.action === "models") {
    const res = await upstream("/models");
    if (!res) return json({ error: `Can't reach ${base}`, unreachable: true }, 502);
    if (!res.ok) return upstreamError(res);
    const models = Models.safeParse(await res.json());
    if (!models.success) return json({ error: "Provider's model list has an unexpected format" }, 502);
    return json({ models: models.data.data.map((m) => m.id).sort() });
  }

  const chat = (response_format: unknown, messages = body.messages) =>
    upstream("/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model: body.model, messages, temperature: 0.2, stream: false, response_format }),
    });

  let res = await chat({ type: "json_schema", json_schema: { name: "response", schema: body.jsonSchema } });
  // Not every provider/model supports json_schema; fall back to plain JSON mode
  // with the schema spelled out in the prompt. zod still validates the result.
  if (res && res.status === 400) {
    const withSchema = [
      ...body.messages,
      { role: "system" as const, content: `Reply with JSON only, matching this JSON Schema:\n${JSON.stringify(body.jsonSchema)}` },
    ];
    res = await chat({ type: "json_object" }, withSchema);
  }
  if (!res) return json({ error: `Can't reach ${base}`, unreachable: true }, 502);
  if (!res.ok) return upstreamError(res);
  const completion = Completion.safeParse(await res.json());
  if (!completion.success) return json({ error: "Provider's reply has an unexpected format" }, 502);
  return json({ content: completion.data.choices[0].message.content ?? "" });
}
