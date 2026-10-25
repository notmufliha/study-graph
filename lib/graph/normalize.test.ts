import { describe, expect, it } from "vitest";
import { edgeKey, findByLabel, labelKey, matchSelection, normalizeLabel } from "./normalize";

describe("normalizeLabel", () => {
  it("lowercases, trims, collapses spaces and strips wrapping punctuation", () => {
    expect(normalizeLabel("  **Binary   Search Tree**. ")).toBe("binary search tree");
    expect(normalizeLabel("“Deadlock”")).toBe("deadlock");
    expect(normalizeLabel("(Mutex)")).toBe("mutex");
  });
});

describe("labelKey", () => {
  it("treats plurals and hyphens as the same concept", () => {
    expect(labelKey("Binary Search Trees")).toBe(labelKey("binary search tree"));
    expect(labelKey("round-robin")).toBe(labelKey("Round Robin"));
    expect(labelKey("processes")).toBe("process");
    expect(labelKey("policies")).toBe("policy");
  });
  it("leaves words that only look plural alone", () => {
    expect(labelKey("process")).toBe("process");
    expect(labelKey("analysis")).toBe("analysis");
    expect(labelKey("bus")).toBe("bus");
  });
});

describe("matching", () => {
  const concepts = [
    { id: "a", label: "binary search tree", aliases: ["BST"] },
    { id: "b", label: "page table", aliases: [] },
    { id: "c", label: "paging", aliases: [] },
  ];
  it("finds concepts by label or alias", () => {
    expect(findByLabel(concepts, "BSTs")?.id).toBe("a");
    expect(findByLabel(concepts, "Page Tables")?.id).toBe("b");
    expect(findByLabel(concepts, "heap")).toBeUndefined();
  });
  it("maps an editor selection to concepts", () => {
    expect(matchSelection("bst", concepts)).toEqual(["a"]);
    expect(matchSelection("Paging uses a page table to map pages.", concepts).sort()).toEqual(["b", "c"]);
    expect(matchSelection("x", concepts)).toEqual([]);
  });
  it("builds stable edge keys", () => {
    expect(edgeKey("Page Tables", " Used For ", "paging")).toBe("page table|used for|paging");
  });
});
