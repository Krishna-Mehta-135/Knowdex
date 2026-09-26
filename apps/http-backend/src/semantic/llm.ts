import { GoogleGenerativeAI } from "@google/generative-ai";

/** Preferred models, fastest/healthiest first. GEMINI_MODEL (if set) always leads. */
export function geminiModels(): string[] {
  return [
    ...new Set(
      [
        process.env.GEMINI_MODEL,
        "gemini-3-flash-preview",
        "gemini-flash-latest",
        "gemini-3.1-flash-lite",
      ].filter((m): m is string => Boolean(m)),
    ),
  ];
}

export const llmAvailable = () => Boolean(process.env.GEMINI_API_KEY);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Per-model circuit breaker ───────────────────────────────────────────────
// Quotas are per model (one can be exhausted while another works) and models
// get retired, so a failing model is skipped for a while instead of being
// retried on every request — that wait was most of the perceived latency.

const cooldownUntil = new Map<string, number>();

/** How long to skip a model after an HTTP failure (ms). 0 = don't skip. */
export function cooldownFor(status: number | undefined): number {
  if (status === 404) return 60 * 60_000; // retired / not available to this key
  if (status === 429) return 2 * 60_000; // quota / rate limit
  if (status === 503 || status === 500) return 20_000; // overloaded
  if (status === 403) return 10 * 60_000;
  return 0;
}

export function markFailure(
  model: string,
  status: number | undefined,
  now = Date.now(),
): void {
  const ms = cooldownFor(status);
  if (ms > 0) cooldownUntil.set(model, now + ms);
}

export function markSuccess(model: string): void {
  cooldownUntil.delete(model);
}

/** Models not cooling down; if every model is cooling, all of them (better than failing outright). */
export function availableModels(now = Date.now()): string[] {
  const all = geminiModels();
  const ok = all.filter((m) => (cooldownUntil.get(m) ?? 0) <= now);
  return ok.length > 0 ? ok : all;
}

export function _resetBreakerForTests(): void {
  cooldownUntil.clear();
}

const statusOf = (e: unknown): number | undefined =>
  (e as { status?: number })?.status;

/** Thinking off: it only adds seconds before the first token for these tasks. */
const FAST = { thinkingConfig: { thinkingBudget: 0 } } as Record<
  string,
  unknown
>;

/**
 * Stream text from Gemini, trying healthy models in order. A 503 gets one quick
 * retry on the same model; 429/404 move on immediately. Throws if none work.
 */
export async function* streamGemini(
  prompt: string,
  opts: { signal?: AbortSignal; systemInstruction?: string } = {},
): AsyncGenerator<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI is not configured (missing GEMINI_API_KEY)");
  const genAI = new GoogleGenerativeAI(key);
  let stream: AsyncGenerator<{ text: () => string }> | null = null;
  let usedModel = "";
  let lastErr: unknown;

  outer: for (const name of availableModels()) {
    for (const fast of [true, false]) {
      // Second pass without thinkingConfig, for models that reject it (HTTP 400).
      for (let attempt = 0; attempt < 2; attempt++) {
        try {
          const res = await genAI
            .getGenerativeModel({
              model: name,
              ...(fast && { generationConfig: FAST }),
              ...(opts.systemInstruction && {
                systemInstruction: opts.systemInstruction,
              }),
            })
            .generateContentStream(
              prompt,
              opts.signal ? { signal: opts.signal } : undefined,
            );
          stream = res.stream as unknown as AsyncGenerator<{
            text: () => string;
          }>;
          usedModel = name;
          break outer;
        } catch (e) {
          lastErr = e;
          if (opts.signal?.aborted) return;
          const status = statusOf(e);
          if (status === 400 && fast) break; // retry this model without thinkingConfig
          markFailure(name, status);
          if (status === 503 && attempt === 0) {
            await sleep(700);
            continue;
          }
          break;
        }
      }
      if (statusOf(lastErr) !== 400) break; // only the 400 case retries without FAST
    }
  }
  if (!stream)
    throw lastErr instanceof Error ? lastErr : new Error("AI unavailable");
  markSuccess(usedModel);
  for await (const part of stream) {
    const t = part.text();
    if (t) yield t;
  }
}

/** One-shot JSON generation. Returns null when no model is available or output is not JSON. */
export async function generateJson<T>(
  prompt: string,
  signal?: AbortSignal,
): Promise<T | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const genAI = new GoogleGenerativeAI(key);
  for (const name of availableModels()) {
    try {
      const res = await genAI
        .getGenerativeModel({
          model: name,
          generationConfig: { responseMimeType: "application/json", ...FAST },
        })
        .generateContent(prompt, signal ? { signal } : undefined);
      const text = res.response
        .text()
        .trim()
        .replace(/^```(?:json)?|```$/g, "");
      markSuccess(name);
      return JSON.parse(text) as T;
    } catch (e) {
      if (signal?.aborted) return null;
      markFailure(name, statusOf(e));
    }
  }
  return null;
}
