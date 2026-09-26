import { describe, expect, it } from "vitest";
import { nextRevealIndex } from "../typewriter";

/** Drive the reveal to completion, returning each frame's visible text. */
function frames(text: string, limit = 5000): string[] {
  const out: string[] = [];
  let shown = 0;
  while (shown < text.length && out.length < limit) {
    shown = nextRevealIndex(text, shown);
    out.push(text.slice(0, shown));
  }
  return out;
}

describe("nextRevealIndex", () => {
  it("always makes progress and finishes exactly at the end", () => {
    const text = "The quick brown fox jumps over the lazy dog. ".repeat(20);
    const f = frames(text);
    expect(f.at(-1)).toBe(text);
    for (let i = 1; i < f.length; i++)
      expect(f[i]!.length).toBeGreaterThan(f[i - 1]!.length);
  });
  it("reveals whole words: a frame ends at a word boundary, never inside a word", () => {
    const text =
      "alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu";
    for (const f of frames(text)) {
      const next = text[f.length];
      expect(next === undefined || /\s/.test(next) || /\s$/.test(f)).toBe(true);
    }
  });
  it("speeds up when a big backlog arrives", () => {
    const small = "hello world foo bar";
    const big = "word ".repeat(400);
    expect(nextRevealIndex(big, 0)).toBeGreaterThan(nextRevealIndex(small, 0));
    expect(frames(big).length).toBeLessThan(big.length / 3); // far fewer frames than characters
  });
  it("handles empty text, already-complete text and shown beyond length", () => {
    expect(nextRevealIndex("", 0)).toBe(0);
    expect(nextRevealIndex("abc", 3)).toBe(3);
    expect(nextRevealIndex("abc", 10)).toBe(3);
  });
  it("does not stall on a single very long token", () => {
    const f = frames("x".repeat(500));
    expect(f.at(-1)!.length).toBe(500);
  });
});
