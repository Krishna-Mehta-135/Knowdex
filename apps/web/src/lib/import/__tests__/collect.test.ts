import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { batchFiles, collectMarkdown } from "../collect";

const file = (name: string, content: string | Uint8Array, path?: string) => {
  const f = new File([content as BlobPart], name);
  if (path) Object.defineProperty(f, "webkitRelativePath", { value: path });
  return f;
};

describe("collectMarkdown", () => {
  it("reads md files, uses folder paths, skips other types and hidden folders", async () => {
    const r = await collectMarkdown([
      file("a.md", "# A", "Vault/a.md"),
      file("b.txt", "B"),
      file("c.png", "x"),
      file("d.md", "hidden", "Vault/.obsidian/d.md"),
    ]);
    expect(r.files.map((f) => f.path)).toEqual(["Vault/a.md", "b.txt"]);
    expect(r.skipped).toEqual([
      { path: "c.png", reason: "not a Markdown or zip file" },
    ]);
  });

  it("extracts md from zips, including nested zips, ignoring __MACOSX", async () => {
    const inner = new JSZip();
    inner.file("Deep/Note 1.md", "deep");
    const outer = new JSZip();
    outer.file("Top.md", "top");
    outer.file("__MACOSX/._Top.md", "junk");
    outer.file("img.png", "bin");
    outer.file("Export.zip", await inner.generateAsync({ type: "uint8array" }));
    const buf = await outer.generateAsync({ type: "uint8array" });
    const r = await collectMarkdown([file("vault.zip", buf)]);
    expect(r.files.map((f) => f.path).sort()).toEqual([
      "Export/Deep/Note 1.md",
      "Top.md",
    ]);
    expect(r.files.find((f) => f.path === "Top.md")?.markdown).toBe("top");
  });

  it("skips oversized and unreadable files without throwing", async () => {
    const big = file("big.md", "x".repeat(500_001));
    const bad = file("bad.zip", new Uint8Array([1, 2, 3]));
    const r = await collectMarkdown([big, bad]);
    expect(r.files).toEqual([]);
    expect(r.skipped.map((s) => s.reason)).toEqual([
      "larger than 500K characters",
      "could not be read",
    ]);
  });
});

describe("batchFiles", () => {
  const mk = (n: number, size = 10) =>
    Array.from({ length: n }, (_, i) => ({
      path: `${i}.md`,
      markdown: "x".repeat(size),
    }));
  it("splits by count and by size, preserving order", () => {
    expect(batchFiles(mk(5), 2).map((b) => b.length)).toEqual([2, 2, 1]);
    expect(batchFiles(mk(4, 50), 100, 120).map((b) => b.length)).toEqual([
      2, 2,
    ]);
    expect(
      batchFiles(mk(3), 10)
        .flat()
        .map((f) => f.path),
    ).toEqual(["0.md", "1.md", "2.md"]);
    expect(batchFiles([])).toEqual([]);
  });
});
