import { normalize } from "./vector.js";

export type EmbedTask = "document" | "query";

export interface Embedder {
  readonly name: string;
  /** Cosine score above which two *documents* count as related. */
  readonly ghostThreshold: number;
  embed(texts: string[], task: EmbedTask): Promise<number[][]>;
}

const STOPWORDS = new Set(
  (
    "a an and are as at be but by for from has have i if in into is it its of on or our so than that the their then " +
    "there these they this to was we were what when which who will with you your not no can do does did been being " +
    "about also more most other some such only own same too very just how why where while would could should may might"
  ).split(" "),
);

export function tokenize(text: string): string[] {
  return (text.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? []).filter(
    (w) => w.length > 1 && !STOPWORDS.has(w),
  );
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Light stemmer so "graphs"/"graph", "linking"/"linked" collide. */
function stem(w: string): string {
  if (w.length > 5 && w.endsWith("ing")) return w.slice(0, -3);
  if (w.length > 4 && w.endsWith("ed")) return w.slice(0, -2);
  if (w.length > 4 && w.endsWith("es")) return w.slice(0, -2);
  if (w.length > 3 && w.endsWith("s") && !w.endsWith("ss"))
    return w.slice(0, -1);
  return w;
}

const LOCAL_DIM = 512;

/**
 * Deterministic feature-hashing embedder. No network, no key: unigrams and
 * bigrams are hashed into a signed 512-d vector (sublinear TF, L2-normalised).
 * Lexical rather than truly semantic, but stable and good enough as a fallback.
 */
export class LocalHashEmbedder implements Embedder {
  public readonly name = "local-hash-v1";
  public readonly ghostThreshold = 0.3;

  public async embed(texts: string[], _task?: EmbedTask): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(LOCAL_DIM).fill(0);
    const toks = tokenize(text).map(stem);
    const counts = new Map<string, number>();
    for (let i = 0; i < toks.length; i++) {
      counts.set(toks[i]!, (counts.get(toks[i]!) ?? 0) + 1);
      if (i > 0) {
        const bg = `${toks[i - 1]}_${toks[i]}`;
        counts.set(bg, (counts.get(bg) ?? 0) + 0.5);
      }
    }
    for (const [tok, c] of counts) {
      const h = fnv1a(tok);
      const idx = h % LOCAL_DIM;
      const sign = (h >>> 16) & 1 ? 1 : -1;
      vec[idx]! += sign * (1 + Math.log(c));
    }
    return normalize(vec);
  }
}

const GEMINI_DIM = 384;

/** Gemini `gemini-embedding-001` via REST, truncated to 384 dims (MRL). */
export class GeminiEmbedder implements Embedder {
  public readonly name = "gemini-embedding-001-384";
  public readonly ghostThreshold = 0.72;
  private disabledUntil = 0;

  public constructor(private readonly apiKey: string | undefined) {}

  public get available(): boolean {
    return Boolean(this.apiKey) && Date.now() >= this.disabledUntil;
  }

  public async embed(texts: string[], task: EmbedTask): Promise<number[][]> {
    if (!this.available) throw new Error("gemini embedder unavailable");
    const taskType =
      task === "query" ? "RETRIEVAL_QUERY" : "RETRIEVAL_DOCUMENT";
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += 50) {
      const batch = texts.slice(i, i + 50);
      const res = await fetch(
        `https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents?key=${this.apiKey}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requests: batch.map((text) => ({
              model: "models/gemini-embedding-001",
              content: { parts: [{ text: text.slice(0, 8000) }] },
              taskType,
              outputDimensionality: GEMINI_DIM,
            })),
          }),
          signal: AbortSignal.timeout(20_000),
        },
      ).catch((e) => {
        this.disabledUntil = Date.now() + 5 * 60_000;
        throw e;
      });
      if (!res.ok) {
        // Bad key / quota: stop hammering the API for a few minutes.
        this.disabledUntil = Date.now() + 5 * 60_000;
        throw new Error(`gemini embed failed: HTTP ${res.status}`);
      }
      const json = (await res.json()) as {
        embeddings?: Array<{ values: number[] }>;
      };
      for (const e of json.embeddings ?? []) out.push(normalize(e.values));
    }
    if (out.length !== texts.length)
      throw new Error("gemini embed: size mismatch");
    return out;
  }
}

const local = new LocalHashEmbedder();
let gemini: GeminiEmbedder | null = null;

export function getGemini(): GeminiEmbedder {
  gemini ??= new GeminiEmbedder(process.env.GEMINI_API_KEY);
  return gemini;
}

export function getLocalEmbedder(): Embedder {
  return local;
}

/** Look an embedder up by the name stored on chunks. */
export function embedderByName(name: string): Embedder | null {
  if (name === local.name) return local;
  const g = getGemini();
  if (name === g.name && g.available) return g;
  return null;
}

/** Best available embedder right now. */
export function preferredEmbedder(): Embedder {
  const g = getGemini();
  return g.available ? g : local;
}

/** Embed with the preferred embedder, transparently degrading to local. */
export async function embedWithFallback(
  texts: string[],
  task: EmbedTask,
): Promise<{ vectors: number[][]; embedder: Embedder }> {
  const pref = preferredEmbedder();
  if (pref !== local) {
    try {
      return { vectors: await pref.embed(texts, task), embedder: pref };
    } catch (e) {
      console.warn(
        "[embed] gemini failed, falling back to local:",
        (e as Error).message,
      );
    }
  }
  return { vectors: await local.embed(texts, task), embedder: local };
}
