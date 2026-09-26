import { GoogleGenerativeAI } from "@google/generative-ai";

/** GEMINI_MODEL first, then stable aliases that survive model retirements. */
export function geminiModels(): string[] {
  return [
    ...new Set(
      [
        process.env.GEMINI_MODEL,
        "gemini-flash-latest",
        "gemini-2.5-flash-lite",
        "gemini-3.1-flash-lite",
        "gemini-3-flash-preview",
      ].filter((m): m is string => Boolean(m)),
    ),
  ];
}

export const llmAvailable = () => Boolean(process.env.GEMINI_API_KEY);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * Stream text from Gemini, trying each model (one quick retry each) until one
 * accepts the request. Throws if none does; yields nothing after a mid-stream
 * failure is thrown to the caller.
 */
export async function* streamGemini(
  prompt: string,
  opts: { signal?: AbortSignal; systemInstruction?: string } = {},
): AsyncGenerator<string> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) throw new Error("AI is not configured (missing GEMINI_API_KEY)");
  const genAI = new GoogleGenerativeAI(key);
  let stream: AsyncGenerator<{ text: () => string }> | null = null;
  let lastErr: unknown;
  outer: for (const name of geminiModels()) {
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await genAI
          .getGenerativeModel({
            model: name,
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
        break outer;
      } catch (e) {
        lastErr = e;
        if (opts.signal?.aborted) return;
        if (attempt === 0) await sleep(1200);
      }
    }
  }
  if (!stream)
    throw lastErr instanceof Error ? lastErr : new Error("AI unavailable");
  for await (const part of stream) {
    const t = part.text();
    if (t) yield t;
  }
}

/** One-shot JSON generation. Returns null when the model is unavailable or output is not JSON. */
export async function generateJson<T>(
  prompt: string,
  signal?: AbortSignal,
): Promise<T | null> {
  const key = process.env.GEMINI_API_KEY;
  if (!key) return null;
  const genAI = new GoogleGenerativeAI(key);
  for (const name of geminiModels()) {
    try {
      const res = await genAI
        .getGenerativeModel({
          model: name,
          generationConfig: { responseMimeType: "application/json" },
        })
        .generateContent(prompt, signal ? { signal } : undefined);
      const text = res.response
        .text()
        .trim()
        .replace(/^```(?:json)?|```$/g, "");
      return JSON.parse(text) as T;
    } catch {
      if (signal?.aborted) return null;
    }
  }
  return null;
}
