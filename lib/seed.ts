import { db } from "./db";
import { t } from "./tiptap";
import type { Note } from "./types";

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

/**
 * Seeds the demo note exactly once per browser. The "seeded" flag lives in the
 * meta table rather than checking "are there any notes?", so a student who
 * deletes the demo note doesn't get it back on the next visit. The transaction
 * makes this safe against React StrictMode running effects twice.
 */
export async function seedIfNeeded() {
  await db.transaction("rw", [db.meta, db.notes], async () => {
    if (await db.meta.get("seeded")) return;
    await db.notes.put(demoNote());
    await db.meta.put({ key: "seeded", value: 1 });
  });
}
