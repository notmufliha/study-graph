"use client";

import { useEffect, useState } from "react";
import type { Editor } from "@tiptap/react";
import { Group, Panel, Separator, useDefaultLayout, usePanelRef } from "react-resizable-panels";
import { NoteEditor } from "./NoteEditor";
import { NoteHeader } from "./NoteHeader";
import { Icon } from "@/components/ui/Icon";
import { GraphPanel } from "@/components/graph/GraphPanel";
import { AIStatus } from "./AIStatus";
import { useLiveGraph } from "./useLiveGraph";
import type { Note } from "@/lib/types";

/** Editor on the left, collapsible/resizable mind-map panel on the right. */
export function NoteWorkspace({ note }: { note: Note }) {
  const graphPanel = usePanelRef();
  const [graphCollapsed, setGraphCollapsed] = useState(false);
  // Remembers the split across visits (localStorage). This component only
  // renders on the client after the note loads, so localStorage is available.
  const layout = useDefaultLayout({ id: "note-split", storage: localStorage });

  // Shared with the graph so nodes and text can highlight each other.
  const [editor, setEditor] = useState<Editor | null>(null);
  const [selectedText, setSelectedText] = useState("");
  useEffect(() => {
    if (!editor) return;
    const onSelection = () => {
      const { from, to, empty } = editor.state.selection;
      setSelectedText(empty ? "" : editor.state.doc.textBetween(from, to, " "));
    };
    editor.on("selectionUpdate", onSelection);
    return () => {
      editor.off("selectionUpdate", onSelection);
    };
  }, [editor]);

  const live = useLiveGraph(note.id, editor);

  const toggleGraph = () => {
    const p = graphPanel.current;
    if (!p) return;
    if (p.isCollapsed()) p.expand();
    else p.collapse();
  };

  return (
    <div className="flex h-full flex-col">
      <NoteHeader note={note}>
        <button
          onClick={toggleGraph}
          title={graphCollapsed ? "Show mind map" : "Hide mind map"}
          className={`flex items-center gap-1.5 rounded-md px-2 py-1 text-sm ${
            graphCollapsed ? "text-muted hover:bg-surface-2 hover:text-fg" : "bg-accent-soft text-accent"
          }`}
        >
          <Icon name="panelRight" /> <span className="hidden sm:inline">Mind map</span>
        </button>
      </NoteHeader>

      <Group
        orientation="horizontal"
        className="min-h-0 flex-1"
        defaultLayout={layout.defaultLayout}
        onLayoutChanged={layout.onLayoutChanged}
      >
        <Panel id="editor" minSize="30">
          <NoteEditor noteId={note.id} initialContent={note.content} onReady={setEditor} />
        </Panel>
        <Separator className="w-1 bg-border transition-colors hover:bg-accent data-[separator=active]:bg-accent" />
        <Panel
          id="graph"
          panelRef={graphPanel}
          defaultSize="40"
          minSize="20"
          collapsible
          collapsedSize={0}
          onResize={(size) => setGraphCollapsed(size.asPercentage === 0)}
        >
          <div className="flex h-full flex-col bg-surface">
            <div className="flex items-center justify-between border-b border-border px-3 py-2 text-sm">
              <div className="flex min-w-0 items-center gap-3">
                <span className="font-medium whitespace-nowrap">Mind map</span>
                <AIStatus status={live.status} detail={live.detail} onAnalyze={live.analyzeAll} />
              </div>
              <button
                aria-label="Collapse mind map"
                onClick={() => graphPanel.current?.collapse()}
                className="rounded p-1 text-muted hover:bg-surface-2 hover:text-fg"
              >
                <Icon name="x" size={14} />
              </button>
            </div>
            <div className="min-h-0 flex-1">
              <GraphPanel view={note.id} editor={editor} editorSelection={selectedText} />
            </div>
          </div>
        </Panel>
      </Group>
    </div>
  );
}
