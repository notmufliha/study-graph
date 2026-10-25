# Study Graph

Notes that turn into a live mind map while you type, and connect concepts across all your notes.

**Try it:** https://study-graph-theta.vercel.app (set up Ollama first; see [Set up the AI](#set-up-the-ai-ollama))

Most study apps only take notes. Study Graph reads what you write, pulls out the concepts you need to learn, and draws how they relate. Because concepts are shared between notes, writing about "mutex" in your Java notes automatically connects them to your Operating Systems notes.

## Features

- **Rich-text notes** with headings, lists, bold, code blocks and Markdown shortcuts (`#`, `-`, `1.`, ` ``` `).
- **Live mind map** beside the editor. About 2.5 s after you stop typing, only the changed paragraphs go to the AI, which returns small add/remove operations instead of a whole new graph.
- **Your edits always win.** Anything you create, rename, move, pin, connect or delete is never changed or re-added by the AI.
- **Full manual editing**: drag nodes, double-click to rename nodes or relations, drag from one node to another to connect them, Delete/Backspace, right-click menu (rename, delete, pin, jump to mention, set type, ask AI to explain), add nodes with + or by double-clicking the canvas, re-layout (pinned nodes stay put), fit view, zoom, minimap, full screen, and undo/redo (Ctrl+Z / Ctrl+Shift+Z).
- **Text ↔ graph highlighting**: click a node to highlight its mentions in the note; select text to highlight the matching node.
- **Cross-note connections**: shared concepts link notes automatically, and the AI suggests dashed links to concepts in other notes. Accept with ✓ or reject with ✗; rejected pairs are never suggested again.
- **Knowledge Graph page** with every concept, filters by tag or note, color by note or type, node size by number of mentions, and a backlinks panel.
- **Search** across titles, text, tags and concept names.
- **Export/import**: a note as Markdown, the graph as PNG, and all data as JSON (and back).
- **Dark mode**, and it works fully as a normal notes app when no AI is reachable.
- **Private and free to host**: everything is stored in your browser (IndexedDB). There is no database or server state, so the Vercel free tier is enough.

## Tech stack

Next.js (App Router) · TypeScript · Tailwind CSS · React Flow (`@xyflow/react`) · dagre · TipTap · Zustand · Dexie (IndexedDB) · zod · react-resizable-panels · Vitest

## Run it locally

Requires Node.js 20.9 or newer.

```bash
npm install
npm run dev
```

Open http://localhost:3000. A demo note, "Intro to Operating Systems", with a pre-built map is created on first visit.

Other scripts:

```bash
npm test          # unit tests (Vitest)
npm run lint
npm run build     # production build, includes the type check
```

## Set up the AI (Ollama)

The default AI is [Ollama](https://ollama.com) on your own computer. It's free, and your notes never leave your machine. **Your browser** talks to Ollama directly, which is why this works even when the site is hosted on Vercel: Vercel's servers can't reach your `localhost`, but your browser can.

1. Install Ollama from https://ollama.com and pull a model:

   ```bash
   ollama pull qwen3:8b
   ```

   Model suggestions:
   - `qwen3:8b`: the default, a good balance.
   - `qwen3:14b`: better links, if you have a strong GPU.
   - `gemma3:4b` or `llama3.2:3b`: for weaker laptops.

   Without a GPU, every update takes much longer (up to a minute or more on a typical laptop CPU).

2. **Allow the site to reach Ollama.** Ollama only accepts browser requests from sites listed in `OLLAMA_ORIGINS`. `localhost` is always allowed, so a local copy works without this step. For the live site:

   **Windows** (PowerShell), then quit Ollama from the system tray and start it again:

   ```powershell
   setx OLLAMA_ORIGINS "https://study-graph-theta.vercel.app,http://localhost:3000"
   ```

   **macOS**, then quit and reopen the Ollama app:

   ```bash
   launchctl setenv OLLAMA_ORIGINS "https://study-graph-theta.vercel.app,http://localhost:3000"
   ```

   **Linux** (systemd): run `sudo systemctl edit ollama`, enter the two lines below, save, then run `sudo systemctl restart ollama`.

   ```ini
   [Service]
   Environment="OLLAMA_ORIGINS=https://study-graph-theta.vercel.app,http://localhost:3000"
   ```

3. Open [Settings](https://study-graph-theta.vercel.app/settings), choose your model, and click **Test connection**.

**If it can't connect:**

- Make sure Ollama is running: http://localhost:11434 should say "Ollama is running".
- Chrome may ask for permission to access devices on your local network. Click **Allow**.
- Safari may block `http://localhost` from an `https://` page. Use Chrome, Edge or Firefox, or run the app locally.

### Hosted AI instead (optional)

In Settings, choose **OpenAI-compatible API** to use Ollama Cloud, Groq, OpenRouter and similar services. Enter the base URL, for example `https://ollama.com/v1`, `https://api.groq.com/openai/v1` or `https://openrouter.ai/api/v1`, plus your API key. Requests go through this app's `/api/ai` route:

- **Your key:** a key you enter is kept in your browser and sent only to that route.
- **Shared key:** a site owner can instead set `AI_API_KEY` on the server, so visitors don't need their own.
- **Allowed URLs:** the route only forwards to public `https://` URLs.

## Deploy your own copy

The app has no database or server state, so it runs on Vercel's free tier.

1. Fork this repository on GitHub.
2. Import the fork at https://vercel.com/new. Vercel detects Next.js automatically, and the default settings work.
3. Optionally, set the `AI_API_KEY` environment variable. It's only used by the hosted-AI option, and it stays on the server.
4. Deploy, then add your deployment's URL to `OLLAMA_ORIGINS` the same way as above, and restart Ollama.

## How it works

- **Storage:** Dexie tables for notes, concepts, edges, per-view node positions, the per-note "deleted by user" blocklist, and rejected suggestion pairs (`lib/db.ts`).
- **Concepts are shared.** They're deduplicated across notes by a normalized label plus aliases (`lib/graph/normalize.ts`), and a concept's `noteIds` lists every note that mentions it. That is what connects notes.
- **Live updates** (`lib/ai/liveGraph.ts`):
  - Each pass diffs the note's top-level blocks against what was sent last time.
  - It sends only the new or edited text, plus a compact `id: label` list of the note's concepts.
  - It asks for `{ addConcepts, addEdges, removeConceptIds }`, as Ollama structured output with a JSON Schema generated from zod.
  - Typing again aborts the request in flight.
- **Merging** (`lib/graph/merge.ts`) is a pure function that enforces the rules:
  - global deduplication, so the same concept is never created twice;
  - the student's deletions are never re-added;
  - student-owned concepts and edges are never touched;
  - only unpinned, unmentioned AI concepts can be removed.
- **Layout:** new nodes are placed with dagre next to their neighbours, and pinned nodes never move (`lib/graph/layout.ts`).
- **Undo/redo:** every manual edit records the before/after state of each row it touches, so undo works however many rows an edit changes (`lib/graph/history.ts`).

```
app/                 pages (notes, graph, settings) and api/ai/route.ts
components/editor/   TipTap editor, toolbar, live-update hook, AI status
components/graph/    GraphPanel, ConceptNode, RelationEdge, ContextMenu
lib/ai/              provider interface, Ollama + OpenAI-compatible providers, prompts, zod schemas
lib/graph/           merge, layout, normalize, undoable graph operations
lib/db.ts            Dexie schema
store/               Zustand stores (UI, settings, undo history)
```

## License

[MIT](LICENSE)
