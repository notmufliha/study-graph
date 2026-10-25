"use client";

import { useState } from "react";
import { createProvider } from "@/lib/ai";
import type { ProviderKind } from "@/lib/ai/provider";
import { useMounted } from "@/lib/useMounted";
import { aiSettings, useSettings } from "@/store/settingsStore";
import { Icon } from "@/components/ui/Icon";
import { downloadFile, exportAll, importAll } from "@/lib/exportImport";

type TestState =
  | { kind: "idle" }
  | { kind: "testing" }
  | { kind: "ok"; message: string }
  | { kind: "fail"; message: string };

export default function SettingsPage() {
  // Settings live in localStorage; render after mount so server and client HTML match.
  if (!useMounted()) return <div className="p-8 text-sm text-muted">Loading…</div>;
  return <SettingsForm />;
}

function SettingsForm() {
  const s = useSettings();
  const [models, setModels] = useState<string[]>([]);
  const [test, setTest] = useState<TestState>({ kind: "idle" });
  const isOllama = s.provider === "ollama";
  const model = isOllama ? s.ollamaModel : s.openaiModel;

  const runTest = async () => {
    setTest({ kind: "testing" });
    try {
      const list = await createProvider(aiSettings()).listModels();
      setModels(list);
      const hasModel = !model || list.includes(model) || list.some((m) => m.split(":")[0] === model);
      setTest(
        hasModel
          ? { kind: "ok", message: `Connected. ${list.length} model${list.length === 1 ? "" : "s"} available.` }
          : {
              kind: "fail",
              message: `Connected, but "${model}" isn't installed.${isOllama ? ` Run: ollama pull ${model}` : " Pick a model from the list."}`,
            },
      );
    } catch (e) {
      setTest({ kind: "fail", message: (e as Error).message });
    }
  };

  const setProvider = (provider: ProviderKind) => {
    s.update({ provider });
    setModels([]);
    setTest({ kind: "idle" });
  };

  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-2xl space-y-8 p-6 md:p-10">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
          <p className="mt-1 text-sm text-muted">
            The AI builds your mind maps as you type. Everything else works without it.
          </p>
        </header>

        <Section title="Live AI mind maps">
          <label className="flex items-center gap-3 text-sm">
            <input type="checkbox" checked={s.enabled} onChange={(e) => s.update({ enabled: e.target.checked })} className="h-4 w-4 accent-[var(--accent)]" />
            Update the mind map automatically a few seconds after I stop typing
          </label>
        </Section>

        <Section title="AI provider">
          <div className="grid gap-2 sm:grid-cols-2">
            <ProviderCard
              active={isOllama}
              onClick={() => setProvider("ollama")}
              title="Ollama on this computer"
              text="Free and private. Your browser talks to Ollama directly."
            />
            <ProviderCard
              active={!isOllama}
              onClick={() => setProvider("openai")}
              title="OpenAI-compatible API"
              text="Ollama Cloud, Groq, OpenRouter… Needs an API key."
            />
          </div>

          {isOllama ? (
            <Field label="Ollama URL">
              <input
                value={s.ollamaUrl}
                onChange={(e) => s.update({ ollamaUrl: e.target.value })}
                placeholder="http://localhost:11434"
                className={inputCls}
              />
            </Field>
          ) : (
            <>
              <Field label="Base URL" hint="Must be a public https:// address, e.g. https://ollama.com/v1, https://api.groq.com/openai/v1, https://openrouter.ai/api/v1">
                <input value={s.openaiUrl} onChange={(e) => s.update({ openaiUrl: e.target.value })} className={inputCls} />
              </Field>
              <Field
                label="API key"
                hint="Stored only in this browser and sent to this app's /api/ai route, which forwards it to the provider. Leave empty if the site owner set AI_API_KEY on the server."
              >
                <input
                  type="password"
                  autoComplete="off"
                  value={s.openaiKey}
                  onChange={(e) => s.update({ openaiKey: e.target.value })}
                  className={inputCls}
                />
              </Field>
            </>
          )}

          <Field
            label="Model"
            hint={
              isOllama
                ? "Recommended: qwen3:8b. On a strong GPU, qwen3:14b finds better links. On a weak laptop, try gemma3:4b or llama3.2:3b."
                : "Use “Test connection” to load the provider's models."
            }
          >
            <div className="flex gap-2">
              {models.length ? (
                <select
                  value={model}
                  onChange={(e) => s.update(isOllama ? { ollamaModel: e.target.value } : { openaiModel: e.target.value })}
                  className={inputCls}
                >
                  {!models.includes(model) && <option value={model}>{model || "Choose a model"} (not installed)</option>}
                  {models.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={model}
                  onChange={(e) => s.update(isOllama ? { ollamaModel: e.target.value } : { openaiModel: e.target.value })}
                  placeholder={isOllama ? "qwen3:8b" : "model name"}
                  className={inputCls}
                />
              )}
            </div>
          </Field>

          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => void runTest()}
              disabled={test.kind === "testing"}
              className="rounded-md bg-accent px-3 py-1.5 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
            >
              {test.kind === "testing" ? "Testing…" : "Test connection"}
            </button>
            {test.kind === "ok" && (
              <span className="flex items-center gap-1 text-sm text-emerald-600 dark:text-emerald-400">
                <Icon name="check" size={14} /> {test.message}
              </span>
            )}
            {test.kind === "fail" && <span className="text-sm text-danger">{test.message}</span>}
          </div>

          {isOllama && <Troubleshooting open={test.kind === "fail"} />}
        </Section>

        <DataSection />
      </div>
    </div>
  );
}

function DataSection() {
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const onExport = async () => {
    const backup = await exportAll();
    const date = new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
    downloadFile(`study-graph-backup-${date}.json`, JSON.stringify(backup, null, 2), "application/json");
    setMessage({ ok: true, text: `Exported ${backup.notes.length} notes and ${backup.concepts.length} concepts.` });
  };

  const onImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const r = await importAll(await file.text());
      setMessage({ ok: true, text: `Imported ${r.notes} notes, ${r.concepts} concepts and ${r.edges} connections.` });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    }
  };

  return (
    <Section title="Your data">
      <p className="text-sm text-muted">
        Notes and maps are stored only in this browser. Export a backup to move to another device, or before clearing
        site data. Importing merges the backup in: notes with the same id are replaced, nothing else is deleted.
      </p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => void onExport()} className="flex items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface">
          <Icon name="download" size={14} /> Export all data (JSON)
        </button>
        <label className="flex cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 py-1.5 text-sm hover:bg-surface focus-within:ring-2 focus-within:ring-accent/30">
          <Icon name="upload" size={14} /> Import backup…
          <input
            type="file"
            accept="application/json,.json"
            className="sr-only"
            onChange={(e) => {
              void onImport(e.target.files?.[0]);
              e.target.value = ""; // allow importing the same file again
            }}
          />
        </label>
      </div>
      {message && <p className={`text-sm ${message.ok ? "text-emerald-600 dark:text-emerald-400" : "text-danger"}`}>{message.text}</p>}
    </Section>
  );
}

const inputCls =
  "w-full rounded-md border border-border bg-bg px-3 py-1.5 text-sm outline-none focus:border-accent focus:ring-2 focus:ring-accent/20";

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="space-y-4">
      <h2 className="text-sm font-semibold tracking-wide text-muted uppercase">{title}</h2>
      {children}
    </section>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="block space-y-1.5">
      <span className="text-sm font-medium">{label}</span>
      {children}
      {hint && <span className="block text-xs text-muted">{hint}</span>}
    </label>
  );
}

function ProviderCard({ active, onClick, title, text }: { active: boolean; onClick: () => void; title: string; text: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-lg border p-3 text-left text-sm ${active ? "border-accent bg-accent-soft" : "border-border hover:bg-surface"}`}
    >
      <div className="font-medium">{title}</div>
      <div className="mt-0.5 text-xs text-muted">{text}</div>
    </button>
  );
}

function Troubleshooting({ open }: { open: boolean }) {
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const origins = origin.startsWith("http://localhost") ? origin : `${origin},http://localhost:3000`;
  return (
    <details open={open} className="rounded-lg border border-border bg-surface p-4 text-sm">
      <summary className="cursor-pointer font-medium">Can&apos;t connect? Troubleshooting</summary>
      <ol className="mt-3 list-decimal space-y-3 pl-5 text-muted">
        <li>
          <span className="text-fg">Ollama must be running.</span> Install it from ollama.com, then run{" "}
          <Code>ollama pull qwen3:8b</Code>. Check it at <Code>http://localhost:11434</Code>; it should say “Ollama is running”.
        </li>
        <li>
          <span className="text-fg">Ollama must allow this site&apos;s origin.</span> Set <Code>OLLAMA_ORIGINS</Code> to{" "}
          <Code>{origins}</Code> and restart Ollama:
          <ul className="mt-2 space-y-1">
            <li>
              Windows (PowerShell): <Code>setx OLLAMA_ORIGINS &quot;{origins}&quot;</Code>, then quit Ollama from the tray and start it again.
            </li>
            <li>
              macOS: <Code>launchctl setenv OLLAMA_ORIGINS &quot;{origins}&quot;</Code>, then restart the Ollama app.
            </li>
            <li>
              Linux (systemd): <Code>sudo systemctl edit ollama</Code>, add <Code>Environment=&quot;OLLAMA_ORIGINS={origins}&quot;</Code>{" "}
              under <Code>[Service]</Code>, then <Code>sudo systemctl restart ollama</Code>.
            </li>
          </ul>
        </li>
        <li>
          <span className="text-fg">Chrome may ask to access devices on your local network.</span> Click <em>Allow</em>, otherwise
          the browser blocks requests from this site to localhost.
        </li>
        <li>
          <span className="text-fg">Safari may block http://localhost from an https page.</span> Use Chrome, Edge or Firefox, or
          run this app locally (<Code>npm run dev</Code>).
        </li>
      </ol>
    </details>
  );
}

function Code({ children }: { children: React.ReactNode }) {
  return <code className="rounded bg-surface-2 px-1 py-0.5 font-mono text-[0.85em] text-fg">{children}</code>;
}
