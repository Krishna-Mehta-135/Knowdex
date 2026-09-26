import { afterEach, describe, expect, it } from "vitest";
import {
  _clearAnswerCacheForTests,
  answerKey,
  getCachedAnswer,
  normalizeQuestion,
  putCachedAnswer,
} from "../answer-cache.js";

afterEach(_clearAnswerCacheForTests);

describe("answer cache", () => {
  it("normalises questions (case, spacing, trailing punctuation)", () => {
    expect(normalizeQuestion("  How do CRDTs   work?? ")).toBe(
      "how do crdts work",
    );
    expect(answerKey("w", 1, "Hello?")).toBe(answerKey("w", 1, "hello"));
  });
  it("hits until TTL, then expires", () => {
    const k = answerKey("w", 1, "q");
    putCachedAnswer(k, "answer", [], 1000);
    expect(getCachedAnswer(k, 1000 + 5 * 60_000)?.text).toBe("answer");
    expect(getCachedAnswer(k, 1000 + 11 * 60_000)).toBeNull();
  });
  it("a new index version or workspace is a different key", () => {
    putCachedAnswer(answerKey("w", 1, "q"), "old", []);
    expect(getCachedAnswer(answerKey("w", 2, "q"))).toBeNull();
    expect(getCachedAnswer(answerKey("other", 1, "q"))).toBeNull();
  });
  it("does not store empty answers and evicts oldest beyond capacity", () => {
    putCachedAnswer("empty", "  ", []);
    expect(getCachedAnswer("empty")).toBeNull();
    for (let i = 0; i < 205; i++) putCachedAnswer(`k${i}`, "x", []);
    expect(getCachedAnswer("k0")).toBeNull();
    expect(getCachedAnswer("k204")).not.toBeNull();
  });
});
