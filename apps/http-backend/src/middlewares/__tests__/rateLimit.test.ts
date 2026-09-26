import { afterEach, describe, expect, it, vi } from "vitest";
import type { Request, Response } from "express";
import { rateLimit } from "../rateLimit.js";

function run(mw: ReturnType<typeof rateLimit>, userId = "u1") {
  const headers: Record<string, string> = {};
  let status = 200;
  const res = {
    setHeader: (k: string, v: string) => void (headers[k] = v),
    status: (c: number) => ((status = c), res),
    json: () => res,
  } as unknown as Response;
  let passed = false;
  mw(
    { user: { id: userId }, ip: "1.1.1.1" } as unknown as Request,
    res,
    () => (passed = true),
  );
  return { passed, status, headers };
}

afterEach(() => {
  vi.useRealTimers();
  delete process.env.RATE_LIMIT_DISABLED;
});

describe("rateLimit", () => {
  it("allows up to max then returns 429 with Retry-After", () => {
    const mw = rateLimit({ name: "ask", max: 3, windowMs: 60_000 });
    expect([1, 2, 3].map(() => run(mw).passed)).toEqual([true, true, true]);
    const blocked = run(mw);
    expect(blocked.passed).toBe(false);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers["Retry-After"])).toBeGreaterThan(0);
  });

  it("limits per user independently and resets after the window", () => {
    vi.useFakeTimers();
    const mw = rateLimit({ name: "x", max: 1, windowMs: 1000 });
    expect(run(mw, "a").passed).toBe(true);
    expect(run(mw, "a").passed).toBe(false);
    expect(run(mw, "b").passed).toBe(true);
    vi.advanceTimersByTime(1500);
    expect(run(mw, "a").passed).toBe(true);
  });

  it("can be disabled by env", () => {
    process.env.RATE_LIMIT_DISABLED = "1";
    const mw = rateLimit({ name: "x", max: 1, windowMs: 1000 });
    expect([run(mw).passed, run(mw).passed, run(mw).passed]).toEqual([
      true,
      true,
      true,
    ]);
  });
});
