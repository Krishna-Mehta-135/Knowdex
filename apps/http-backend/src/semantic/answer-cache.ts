import type { AskSource } from "./ask.js";

interface Entry {
  text: string;
  sources: AskSource[];
  expires: number;
}

const TTL_MS = 10 * 60_000;
const MAX_ENTRIES = 200;
const cache = new Map<string, Entry>();

export const normalizeQuestion = (q: string) =>
  q
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[?!.\s]+$/g, "")
    .trim();

/** Key includes the workspace index version, so any re-index invalidates cached answers. */
export const answerKey = (
  workspaceId: string,
  version: number,
  question: string,
) => `${workspaceId}|${version}|${normalizeQuestion(question)}`;

export function getCachedAnswer(key: string, now = Date.now()): Entry | null {
  const e = cache.get(key);
  if (!e) return null;
  if (e.expires <= now) {
    cache.delete(key);
    return null;
  }
  // refresh LRU order
  cache.delete(key);
  cache.set(key, e);
  return e;
}

export function putCachedAnswer(
  key: string,
  text: string,
  sources: AskSource[],
  now = Date.now(),
): void {
  if (!text.trim()) return;
  cache.set(key, { text, sources, expires: now + TTL_MS });
  while (cache.size > MAX_ENTRIES) cache.delete(cache.keys().next().value!);
}

export function _clearAnswerCacheForTests(): void {
  cache.clear();
}
