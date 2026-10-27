import { OllamaBrowserProvider } from "./ollama";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import type { AIProvider, AISettings } from "./provider";

export function createProvider(s: AISettings): AIProvider {
  if (s.provider === "builtin") return new OpenAICompatibleProvider({ builtin: true });
  return s.provider === "openai"
    ? new OpenAICompatibleProvider({ baseUrl: s.openaiUrl, model: s.openaiModel, apiKey: s.openaiKey })
    : new OllamaBrowserProvider(s.ollamaUrl, s.ollamaModel);
}

export function activeModel(s: AISettings): string {
  if (s.provider === "builtin") return "";
  return s.provider === "openai" ? s.openaiModel : s.ollamaModel;
}
