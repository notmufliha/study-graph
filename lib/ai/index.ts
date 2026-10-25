import { OllamaBrowserProvider } from "./ollama";
import { OpenAICompatibleProvider } from "./openaiCompatible";
import type { AIProvider, AISettings } from "./provider";

export function createProvider(s: AISettings): AIProvider {
  return s.provider === "openai"
    ? new OpenAICompatibleProvider(s.openaiUrl, s.openaiModel, s.openaiKey)
    : new OllamaBrowserProvider(s.ollamaUrl, s.ollamaModel);
}

export function activeModel(s: AISettings): string {
  return s.provider === "openai" ? s.openaiModel : s.ollamaModel;
}
