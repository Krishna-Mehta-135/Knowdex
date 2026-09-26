import { describe, expect, it } from "vitest";
import {
  detectCommunities,
  hashIndex,
  paletteColor,
  CLUSTER_PALETTE,
} from "../communities";

const clique = (ids: string[]) =>
  ids.flatMap((a, i) => ids.slice(i + 1).map((b) => ({ a, b })));

describe("detectCommunities", () => {
  const A = ["a1", "a2", "a3", "a4"];
  const B = ["b1", "b2", "b3"];
  const ids = [...A, ...B, "solo"];
  const edges = [...clique(A), ...clique(B), { a: "a1", b: "b1" }];

  it("separates two dense clusters joined by one bridge, largest first", () => {
    const c = detectCommunities(ids, edges);
    expect(new Set(A.map((i) => c.get(i))).size).toBe(1);
    expect(new Set(B.map((i) => c.get(i))).size).toBe(1);
    expect(c.get("a1")).not.toBe(c.get("b1"));
    expect(c.get("a1")).toBe(0); // bigger cluster gets index 0
    expect(c.get("b1")).toBe(1);
  });
  it("leaves isolated nodes uncoloured (-1)", () => {
    expect(detectCommunities(ids, edges).get("solo")).toBe(-1);
  });
  it("is deterministic regardless of input order", () => {
    const x = detectCommunities(ids, edges);
    const y = detectCommunities([...ids].reverse(), [...edges].reverse());
    expect([...x]).toEqual([...y]);
  });
  it("ignores self loops, dangling and duplicate edges; handles empty input", () => {
    const c = detectCommunities(
      ["x", "y"],
      [
        { a: "x", b: "x" },
        { a: "x", b: "zzz" },
        { a: "x", b: "y" },
        { a: "y", b: "x" },
      ],
    );
    expect(c.get("x")).toBe(c.get("y"));
    expect(detectCommunities([], []).size).toBe(0);
  });
});

describe("palette helpers", () => {
  it("wraps and hashes stably", () => {
    expect(paletteColor(0)).toBe(CLUSTER_PALETTE[0]);
    expect(paletteColor(CLUSTER_PALETTE.length)).toBe(CLUSTER_PALETTE[0]);
    expect(hashIndex("cooking")).toBe(hashIndex("cooking"));
    expect(hashIndex("cooking")).toBeLessThan(CLUSTER_PALETTE.length);
  });
});
