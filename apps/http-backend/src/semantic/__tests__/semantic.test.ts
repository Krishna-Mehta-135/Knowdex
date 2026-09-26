import { describe, expect, it } from "vitest";
import * as Y from "yjs";
import { chunkText } from "../chunker.js";
import { extractPlainText } from "../text.js";
import { LocalHashEmbedder } from "../embedder.js";
import { cosine, centroid } from "../vector.js";
import { computeGhostEdges, nearestDocs } from "../search.js";

function makeState(paragraphs: string[], wiki?: string): Uint8Array {
  const doc = new Y.Doc();
  const frag = doc.getXmlFragment("content");
  for (const p of paragraphs) {
    const el = new Y.XmlElement("paragraph");
    const t = new Y.XmlText();
    t.insert(0, p);
    el.insert(0, [t]);
    frag.push([el]);
  }
  if (wiki) {
    const el = new Y.XmlElement("paragraph");
    const w = new Y.XmlElement("wikiLink");
    w.setAttribute("title", wiki);
    el.insert(0, [w]);
    frag.push([el]);
  }
  return Y.encodeStateAsUpdate(doc);
}

describe("extractPlainText", () => {
  it("joins paragraphs and includes wiki link titles", () => {
    const text = extractPlainText(
      makeState(["Hello world", "Second para"], "Target Note"),
    );
    expect(text).toContain("Hello world");
    expect(text).toContain("Second para");
    expect(text).toContain("Target Note");
    expect(text.split("\n").length).toBeGreaterThanOrEqual(3);
  });
  it("returns empty string for empty / corrupt state", () => {
    expect(extractPlainText(new Uint8Array())).toBe("");
    expect(extractPlainText(new Uint8Array([1, 2, 3, 4]))).toBe("");
  });
});

describe("chunkText", () => {
  it("returns [] for blank input", () => {
    expect(chunkText("  \n ")).toEqual([]);
  });
  it("keeps short text as one chunk", () => {
    expect(chunkText("one\n\ntwo")).toEqual(["one\n\ntwo"]);
  });
  it("never exceeds the size limit", () => {
    const long = Array.from(
      { length: 60 },
      (_, i) => `Sentence number ${i} is here.`,
    ).join(" ");
    const blob = "x".repeat(3000);
    for (const c of chunkText(`${long}\n\n${blob}\n\n${long}`, {
      size: 400,
      overlap: 50,
    })) {
      expect(c.length).toBeLessThanOrEqual(400);
    }
  });
  it("splits many paragraphs into multiple chunks that cover all text", () => {
    const paras = Array.from(
      { length: 30 },
      (_, i) => `Paragraph ${i} ${"word ".repeat(30)}`,
    );
    const chunks = chunkText(paras.join("\n\n"), { size: 500, overlap: 0 });
    expect(chunks.length).toBeGreaterThan(1);
    const joined = chunks.join("\n\n");
    for (let i = 0; i < 30; i++) expect(joined).toContain(`Paragraph ${i} `);
  });
});

describe("stem", () => {
  it("conflates common inflections", async () => {
    const { stem } = await import("../embedder.js");
    expect(stem("baking")).toBe(stem("bake"));
    expect(stem("baked")).toBe(stem("bake"));
    expect(stem("bakes")).toBe(stem("bake"));
    expect(stem("making")).toBe(stem("make"));
    expect(stem("notes")).toBe(stem("note"));
    expect(stem("bodies")).toBe(stem("body"));
    expect(stem("class")).toBe("class");
  });
});

describe("LocalHashEmbedder", () => {
  const e = new LocalHashEmbedder();
  it("is deterministic and unit-length", async () => {
    const [a] = await e.embed(
      ["graph databases store relationships"],
      "document",
    );
    const [b] = await e.embed(
      ["graph databases store relationships"],
      "document",
    );
    expect(a).toEqual(b);
    expect(Math.hypot(...a!)).toBeCloseTo(1, 5);
  });
  it("scores related text above unrelated text", async () => {
    const [q, rel, unrel] = await e.embed(
      [
        "knowledge graph linking notes together",
        "linking notes builds a knowledge graph of ideas",
        "recipe for chocolate cake with butter and sugar",
      ],
      "document",
    );
    expect(cosine(q!, rel!)).toBeGreaterThan(cosine(q!, unrel!) + 0.15);
  });
  it("handles empty text without NaN", async () => {
    const [v] = await e.embed([""], "query");
    expect(v!.every((x) => Number.isFinite(x))).toBe(true);
  });
});

describe("ghost edges", () => {
  const mk = (docId: string, v: number[], embedder = "m") => ({
    docId,
    embedder,
    vector: centroid([v]),
  });
  const vecs = [
    mk("a", [1, 0.05, 0]),
    mk("b", [1, 0.1, 0]),
    mk("c", [0.98, 0, 0.1]),
    mk("d", [0, 1, 0]),
    mk("z", [1, 0, 0], "other"),
  ];
  it("suggests close pairs and skips far ones and other embedders", () => {
    const edges = computeGhostEdges(vecs, new Set(), () => 0.9, 10);
    const keys = edges.map((e) => [e.a, e.b].sort().join("|"));
    expect(keys).toContain("a|b");
    expect(keys.some((k) => k.includes("d"))).toBe(false);
    expect(keys.some((k) => k.includes("z"))).toBe(false);
  });
  it("excludes pairs already linked", () => {
    const edges = computeGhostEdges(vecs, new Set(["a|b"]), () => 0.9, 10);
    expect(
      edges.find((e) => [e.a, e.b].sort().join("|") === "a|b"),
    ).toBeUndefined();
  });
  it("caps suggestions per node", () => {
    const edges = computeGhostEdges(vecs, new Set(), () => 0.9, 1);
    const count = new Map<string, number>();
    for (const e of edges)
      for (const id of [e.a, e.b]) count.set(id, (count.get(id) ?? 0) + 1);
    for (const n of count.values()) expect(n).toBeLessThanOrEqual(1);
  });
  it("nearestDocs ranks by similarity", () => {
    const [top] = nearestDocs(vecs[0]!, vecs, 3);
    expect(["b", "c"]).toContain(top!.docId);
  });
});
