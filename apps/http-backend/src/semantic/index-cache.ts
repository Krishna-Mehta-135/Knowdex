import { prisma } from "@repo/db";
import { stem, tokenize } from "./embedder.js";
import { centroid } from "./vector.js";

export interface CachedChunk {
  sourceId: string;
  sourceType: string;
  idx: number;
  text: string;
  embedder: string;
  embedding: number[];
  /** Stemmed token set for the lexical half of hybrid search. */
  tokens: Set<string>;
}

export interface DocVector {
  docId: string;
  embedder: string;
  vector: number[];
}

interface Entry {
  version: number;
  chunks: CachedChunk[];
  docVectors?: DocVector[];
}

const versions = new Map<string, number>();
const cache = new Map<string, Entry>();
const MAX_WORKSPACES = 24;
const MAX_CHUNKS_CACHED = 60_000;

/** Call after any chunk write/delete so the next query rebuilds the cache. */
export function bumpWorkspace(workspaceId: string): void {
  versions.set(workspaceId, (versions.get(workspaceId) ?? 0) + 1);
  cache.delete(workspaceId);
}

export function stemmedTokens(text: string): Set<string> {
  return new Set(tokenize(text).map(stem));
}

/**
 * All chunks of a workspace, cached in memory. A workspace is loaded from
 * Postgres once and reused until something in it is re-indexed, instead of
 * pulling every embedding on every search / graph / related request.
 */
export async function loadWorkspaceChunks(workspaceId: string): Promise<Entry> {
  const version = versions.get(workspaceId) ?? 0;
  const hit = cache.get(workspaceId);
  if (hit && hit.version === version) {
    // refresh LRU position
    cache.delete(workspaceId);
    cache.set(workspaceId, hit);
    return hit;
  }
  const rows = await prisma.docChunk.findMany({
    where: { workspaceId },
    select: {
      sourceId: true,
      sourceType: true,
      idx: true,
      text: true,
      embedder: true,
      embedding: true,
    },
  });
  const entry: Entry = {
    version,
    chunks: rows.map((r) => ({ ...r, tokens: stemmedTokens(r.text) })),
  };
  // A write may have landed while we were reading; only cache if still current.
  if (
    (versions.get(workspaceId) ?? 0) === version &&
    rows.length <= MAX_CHUNKS_CACHED
  ) {
    cache.set(workspaceId, entry);
    while (cache.size > MAX_WORKSPACES)
      cache.delete(cache.keys().next().value!);
  }
  return entry;
}

/** One centroid vector per source, memoised on the cache entry. */
export async function loadDocVectors(
  workspaceId: string,
): Promise<DocVector[]> {
  const entry = await loadWorkspaceChunks(workspaceId);
  if (entry.docVectors) return entry.docVectors;
  const groups = new Map<string, { embedder: string; vs: number[][] }>();
  for (const c of entry.chunks) {
    const g = groups.get(c.sourceId) ?? { embedder: c.embedder, vs: [] };
    if (g.embedder === c.embedder) g.vs.push(c.embedding);
    groups.set(c.sourceId, g);
  }
  entry.docVectors = [...groups].map(([docId, g]) => ({
    docId,
    embedder: g.embedder,
    vector: centroid(g.vs),
  }));
  return entry.docVectors;
}

export function _clearCacheForTests(): void {
  cache.clear();
  versions.clear();
}
