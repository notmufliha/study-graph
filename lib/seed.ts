import { db } from "./db";
import { blocksOf, t } from "./tiptap";
import type { Concept, ConceptType, Edge, Note } from "./types";

export const DEMO_NOTE_ID = "demo-intro-os";

const demoDoc = t.doc(
  t.h(1, "Intro to Operating Systems"),
  t.p(
    "An ",
    t.b("operating system"),
    " is software that manages hardware resources and provides services to programs. Its core is the ",
    t.b("kernel"),
    ", which runs in privileged kernel mode.",
  ),
  t.h(2, "Processes and threads"),
  t.p(
    "A ",
    t.b("process"),
    " is a program in execution, with its own address space. A ",
    t.b("thread"),
    " is part of a process: threads share the process's memory but have their own stack and registers.",
  ),
  t.ul(
    "The scheduler decides which process runs next on the CPU.",
    "Round robin scheduling gives each process a fixed time slice.",
    "A context switch saves one process's state and loads another's.",
  ),
  t.h(2, "Memory management"),
  t.p(
    t.b("Virtual memory"),
    " gives each process the illusion of a large private address space. It is implemented with ",
    t.b("paging"),
    ": memory is split into fixed-size pages, mapped to physical frames by the page table.",
  ),
  t.p("A page fault happens when a process touches a page that is not in RAM; the OS loads it from disk."),
  t.h(2, "Concurrency"),
  t.p(
    "A ",
    t.b("deadlock"),
    " is when processes wait on each other forever. It requires four conditions: mutual exclusion, hold and wait, no preemption, and circular wait. A ",
    t.b("mutex"),
    " is used for mutual exclusion around a critical section.",
  ),
  t.h(2, "System calls"),
  t.p("Programs ask the kernel for services through system calls, for example:"),
  t.codeBlock('int fd = open("notes.txt", O_RDONLY);\nread(fd, buf, 128);', "c"),
);

export const demoNote = (): Note => ({
  id: DEMO_NOTE_ID,
  title: "Intro to Operating Systems",
  content: JSON.stringify(demoDoc),
  tags: ["cs", "os"],
  createdAt: Date.now(),
  updatedAt: Date.now(),
});

// Pre-built mind map for the demo note, so the app looks alive on first open.
// [label, type, summary, aliases]
const demoConcepts: [string, ConceptType, string, string[]?][] = [
  ["operating system", "term", "Software that manages hardware and provides services to programs", ["os"]],
  ["kernel", "term", "Core of the OS, runs in privileged mode"],
  ["kernel mode", "term", "Privileged CPU mode the kernel runs in"],
  ["system call", "process", "How a program asks the kernel for a service", ["syscall"]],
  ["process", "term", "A program in execution with its own address space"],
  ["thread", "term", "Unit of execution inside a process; shares its memory"],
  ["address space", "term", "The memory a process can see"],
  ["scheduler", "process", "Decides which process runs next on the CPU"],
  ["round robin", "process", "Scheduling with a fixed time slice per process"],
  ["context switch", "process", "Saving one process's state and loading another's"],
  ["virtual memory", "term", "Gives each process a large private address space"],
  ["paging", "process", "Splitting memory into fixed-size pages"],
  ["page table", "term", "Maps pages to physical frames"],
  ["page fault", "process", "Access to a page that is not in RAM"],
  ["deadlock", "term", "Processes waiting on each other forever"],
  ["mutual exclusion", "term", "Only one process may hold a resource at a time"],
  ["hold and wait", "term", "Holding one resource while waiting for another"],
  ["no preemption", "term", "Resources can't be taken away forcibly"],
  ["circular wait", "term", "A cycle of processes each waiting on the next"],
  ["mutex", "term", "Lock used for mutual exclusion", ["lock"]],
  ["critical section", "term", "Code that touches shared data"],
];

// [source, relation, target]
const demoEdges: [string, string, string][] = [
  ["kernel", "part of", "operating system"],
  ["kernel", "runs in", "kernel mode"],
  ["system call", "requests service from", "kernel"],
  ["process", "has", "address space"],
  ["thread", "part of", "process"],
  ["scheduler", "part of", "operating system"],
  ["scheduler", "selects", "process"],
  ["round robin", "example of", "scheduler"],
  ["context switch", "used by", "scheduler"],
  ["virtual memory", "provides", "address space"],
  ["paging", "implements", "virtual memory"],
  ["page table", "used for", "paging"],
  ["page fault", "part of", "paging"],
  ["deadlock", "requires", "mutual exclusion"],
  ["deadlock", "requires", "hold and wait"],
  ["deadlock", "requires", "no preemption"],
  ["deadlock", "requires", "circular wait"],
  ["mutex", "used for", "mutual exclusion"],
  ["mutex", "protects", "critical section"],
];

const demoId = (label: string) => `demo-${label.replace(/\s+/g, "-")}`;

async function seedDemoGraph() {
  const concepts: Concept[] = demoConcepts.map(([label, type, summary, aliases]) => ({
    id: demoId(label),
    label,
    type,
    summary,
    aliases: aliases ?? [],
    noteIds: [DEMO_NOTE_ID],
    origin: "ai",
  }));
  const edges: Edge[] = demoEdges.map(([s, relation, t], i) => ({
    id: `demo-e${i}`,
    source: demoId(s),
    target: demoId(t),
    relation,
    noteId: DEMO_NOTE_ID,
    origin: "ai",
    status: "accepted",
  }));
  // No layouts: the graph panel lays out unpositioned concepts with dagre on first view.
  await db.concepts.bulkPut(concepts);
  await db.edges.bulkPut(edges);
  // The map above already covers this text, so live AI updates start from here.
  await db.meta.put({ key: `ai:${DEMO_NOTE_ID}`, value: { blocks: blocksOf(demoDoc).map((b) => b.text) } });
}

/**
 * Seeds the demo note exactly once per browser. The "seeded" flag lives in the
 * meta table rather than checking "are there any notes?", so a student who
 * deletes the demo note doesn't get it back on the next visit. The transaction
 * makes this safe against React StrictMode running effects twice.
 * The graph has its own flag so browsers seeded before it existed still get it.
 */
export async function seedIfNeeded() {
  await db.transaction("rw", [db.meta, db.notes, db.concepts, db.edges], async () => {
    if (!(await db.meta.get("seeded"))) {
      await db.notes.put(demoNote());
      await db.meta.put({ key: "seeded", value: 1 });
    }
    if (!(await db.meta.get("seededGraph"))) {
      if (await db.notes.get(DEMO_NOTE_ID)) await seedDemoGraph();
      await db.meta.put({ key: "seededGraph", value: 1 });
    }
  });
}
