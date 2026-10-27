import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "./route";

const fetchMock = vi.fn();
const post = (body: unknown) => POST(new Request("http://app/api/ai", { method: "POST", body: JSON.stringify(body) }));
const chat = { action: "chat", messages: [{ role: "user", content: "hi" }], jsonSchema: {} };
const reply = () => Response.json({ choices: [{ message: { content: "{}" } }] });

beforeEach(() => {
  vi.stubGlobal("fetch", fetchMock);
  vi.stubEnv("AI_API_KEY", "server-secret");
  vi.stubEnv("AI_BASE_URL", "https://owner-provider.example/v1");
  vi.stubEnv("AI_MODEL", "owner-model");
});
afterEach(() => {
  fetchMock.mockReset();
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("/api/ai", () => {
  it("sends the built-in AI to the server's provider, model and key", async () => {
    fetchMock.mockResolvedValue(reply());
    expect((await post({ builtin: true, ...chat })).status).toBe(200);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://owner-provider.example/v1/chat/completions");
    expect(init.headers.Authorization).toBe("Bearer server-secret");
    expect(JSON.parse(init.body).model).toBe("owner-model");
  });

  it("never sends the server key to a URL the client chose", async () => {
    const res = await post({ baseUrl: "https://attacker.example/v1", model: "m", ...chat });
    expect(res.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses the user's own key for their own provider", async () => {
    fetchMock.mockResolvedValue(reply());
    await post({ baseUrl: "https://api.groq.com/openai/v1", apiKey: "user-key", model: "m", ...chat });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer user-key");
  });

  it("explains when the built-in AI isn't configured", async () => {
    vi.stubEnv("AI_API_KEY", "");
    const res = await post({ builtin: true, ...chat });
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/isn't set up/);
  });
});
