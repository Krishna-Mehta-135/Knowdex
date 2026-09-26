import { afterEach, describe, expect, it } from "vitest";
import {
  _resetBreakerForTests,
  availableModels,
  cooldownFor,
  geminiModels,
  markFailure,
  markSuccess,
} from "../llm.js";

afterEach(() => {
  _resetBreakerForTests();
  delete process.env.GEMINI_MODEL;
});

describe("model order", () => {
  it("leads with GEMINI_MODEL, dedupes, and never lists retired models", () => {
    process.env.GEMINI_MODEL = "gemini-3-flash-preview";
    const m = geminiModels();
    expect(m[0]).toBe("gemini-3-flash-preview");
    expect(new Set(m).size).toBe(m.length);
    expect(m.join()).not.toContain("2.5");
  });
});

describe("circuit breaker", () => {
  it("skips a model after 429 / 404 and brings it back after the cooldown", () => {
    const [first, second] = geminiModels();
    const t0 = 1_000_000;
    markFailure(first!, 429, t0);
    expect(availableModels(t0 + 1000)).not.toContain(first);
    expect(availableModels(t0 + 1000)[0]).toBe(second);
    expect(availableModels(t0 + cooldownFor(429) + 1)).toContain(first);
    markFailure(second!, 404, t0);
    expect(availableModels(t0 + 3 * 60_000)).not.toContain(second); // 404 lasts an hour
  });
  it("ignores errors that are not availability problems", () => {
    markFailure(geminiModels()[0]!, 400);
    markFailure(geminiModels()[0]!, undefined);
    expect(availableModels()[0]).toBe(geminiModels()[0]);
  });
  it("falls back to every model when all are cooling down", () => {
    const t0 = 5_000_000;
    for (const m of geminiModels()) markFailure(m, 429, t0);
    expect(availableModels(t0 + 1000)).toEqual(geminiModels());
  });
  it("success clears the cooldown", () => {
    const m = geminiModels()[0]!;
    markFailure(m, 503, Date.now());
    markSuccess(m);
    expect(availableModels()).toContain(m);
  });
});
