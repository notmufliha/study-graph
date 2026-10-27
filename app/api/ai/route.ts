import { z } from "zod";

// Proxy for OpenAI-compatible providers (see lib/ai/openaiCompatible.ts).
// The local-Ollama path never touches this route: the browser calls Ollama directly.

const Message = z.object({ role: z.enum(["system", "user", "assistant"]), content: z.string().max(60_000) });

// Either the built-in AI (provider, model and key all come from the server's env)
// or the user's own provider, where the user must supply their own key.
const Target = z.union([
  z.object({ builtin: z.literal(true) }),
  z.object({ builtin: z.undefined().optional(), baseUrl: z.string().url(), apiKey: z.string().optional(), model: z.string().optional() }),
]);

const Body = z.intersection(
  Target,
  z.discriminatedUnion("action", [
    z.object({ action: z.literal("chat"), messages: z.array(Message).min(1).max(20), jsonSchema: z.record(z.string(), z.unknown()) }),
    z.object({ action: z.literal("models") }),
  ]),
);

const DEFAULT_BUILTIN_URL = "https://api.groq.com/openai/v1";
const DEFAULT_BUILTIN_MODEL = "llama-3.3-70b-versatile";

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

  // AI_API_KEY is only ever sent to AI_BASE_URL, never to a URL the client picks;
  // otherwise anyone could point the route at their own server and read the key.
  let baseUrl: string, key: string, model: string;
  if (body.builtin) {
    key = process.env.AI_API_KEY ?? "";
    if (!key) return json({ error: "The built-in AI isn't set up on this site. Choose another provider in Settings." }, 400);
    baseUrl = process.env.AI_BASE_URL || DEFAULT_BUILTIN_URL;
    model = process.env.AI_MODEL || DEFAULT_BUILTIN_MODEL;
  } else {
    if (!isAllowedTarget(body.baseUrl)) {
      return json({ error: "Base URL must be a public https:// address. For a local Ollama, choose the Ollama provider." }, 400);
    }
    if (!body.apiKey) return json({ error: "Enter your API key in Settings." }, 400);
    baseUrl = body.baseUrl;
    key = body.apiKey;
    model = body.model ?? "";
  }

  const base = baseUrl.replace(/\/+$/, "");
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
    // Visitors don't pick the built-in model; reaching the provider is enough.
    if (body.builtin) return json({ models: [model] });
    const models = Models.safeParse(await res.json());
    if (!models.success) return json({ error: "Provider's model list has an unexpected format" }, 502);
    return json({ models: models.data.data.map((m) => m.id).sort() });
  }

  const chat = (response_format: unknown, messages = body.messages) =>
    upstream("/chat/completions", {
      method: "POST",
      body: JSON.stringify({ model, messages, temperature: 0.2, stream: false, response_format }),
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
