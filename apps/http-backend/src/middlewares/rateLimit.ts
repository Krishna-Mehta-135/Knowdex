import { NextFunction, Request, Response } from "express";
import { ApiResponse } from "../utils/ApiResponse";

interface Options {
  /** Bucket name, so limits are independent per endpoint group. */
  name: string;
  max: number;
  windowMs: number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window per-user limiter (falls back to IP). In-memory: fine for a
 * single backend instance, and it protects Gemini spend / expensive endpoints.
 * Disable with RATE_LIMIT_DISABLED=1.
 */
export function rateLimit({ name, max, windowMs }: Options) {
  const buckets = new Map<string, Bucket>();
  const sweep = setInterval(
    () => {
      const now = Date.now();
      for (const [k, b] of buckets) if (b.resetAt <= now) buckets.delete(k);
    },
    Math.max(windowMs, 30_000),
  );
  sweep.unref();

  return (req: Request, res: Response, next: NextFunction) => {
    if (process.env.RATE_LIMIT_DISABLED === "1") return next();
    const key = req.user?.id ?? req.ip ?? "anon";
    const now = Date.now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= now) {
      b = { count: 0, resetAt: now + windowMs };
      buckets.set(key, b);
    }
    b.count++;
    res.setHeader("X-RateLimit-Limit", String(max));
    res.setHeader("X-RateLimit-Remaining", String(Math.max(0, max - b.count)));
    if (b.count > max) {
      const retry = Math.ceil((b.resetAt - now) / 1000);
      res.setHeader("Retry-After", String(retry));
      return res
        .status(429)
        .json(
          new ApiResponse(
            429,
            null,
            `Too many ${name} requests. Try again in ${retry}s.`,
          ),
        );
    }
    next();
  };
}
