import { prisma } from "@repo/db";
import { embedderByName, getLocalEmbedder, type Embedder } from "./embedder.js";
import { cosine, dot } from "./vector.js";
import {
  loadDocVectors,
  loadWorkspaceChunks,
  stemmedTokens,
  type DocVector,
} from "./index-cache.js";

export interface ScoredChunk {
  sourceId: string;
  sourceType: string;
  idx: number;
  text: string;
  score: number;
  /** Minimum score for this chunk's embedder to count as relevant. */
  floor: number;
}

export async function isMember(userId: string, workspaceId: string) {
  const m = await prisma.workspaceMember.findUnique({
    where: { workspaceId_userId: { workspaceId, userId } },
  });
  return Boolean(m);
}

/** Query embedding for each embedder that has chunks in the workspace. */
async function queryVectors(
  chunksEmbedders: Set<string>,
  query: string,
): Promise<Map<string, number[]>> {
  const out = new Map<string, number[]>();
  for (const name of chunksEmbedders) {
    let emb: Embedder | null = embedderByName(name);
    if (!emb) continue;
    try {
      const [v] = await emb.embed([query], "query");
      if (v) out.set(name, v);
    } catch {
      /* skip this embedder */
    }
  }
  if (out.size === 0) {
    const local = getLocalEmbedder();
    const [v] = await local.embed([query], "query");
    if (v) out.set(local.name, v);
  }
  return out;
}

export async function searchChunks(
  workspaceId: string,
  query: string,
  k = 8,
): Promise<ScoredChunk[]> {
  const { chunks } = await loadWorkspaceChunks(workspaceId);
  if (chunks.length === 0) return [];
  const qv = await queryVectors(new Set(chunks.map((c) => c.embedder)), query);
  const qTokens = [...stemmedTokens(query)];
  const scored: ScoredChunk[] = [];
  for (const c of chunks) {
    const v = qv.get(c.embedder);
    if (!v) continue;
    const vec = dot(v, c.embedding);
    // Hybrid: vectors capture meaning, exact term overlap rescues names/IDs/rare
    // words that embeddings blur. Additive so per-embedder thresholds still apply.
    let lexical = 0;
    if (qTokens.length > 0) {
      let hit = 0;
      for (const t of qTokens) if (c.tokens.has(t)) hit++;
      lexical = hit / qTokens.length;
    }
    const floor = embedderByName(c.embedder)?.searchFloor ?? 0.05;
    scored.push({
      sourceId: c.sourceId,
      sourceType: c.sourceType,
      idx: c.idx,
      text: c.text,
      score: vec + 0.15 * lexical,
      floor,
    });
  }
  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, k);
}

export type { DocVector };

/** One centroid vector per source (note or attachment) in the workspace. */
export async function docVectors(workspaceId: string): Promise<DocVector[]> {
  return loadDocVectors(workspaceId);
}

export interface Neighbor {
  docId: string;
  score: number;
}

export function nearestDocs(
  target: DocVector,
  all: DocVector[],
  k: number,
): Neighbor[] {
  return all
    .filter((d) => d.docId !== target.docId && d.embedder === target.embedder)
    .map((d) => ({ docId: d.docId, score: cosine(target.vector, d.vector) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}

export interface GhostEdge {
  a: string;
  b: string;
  score: number;
}

const MAX_GHOST_DOCS = 500;

/**
 * Pairs of notes that are semantically close but not connected by a [[link]]
 * (in either direction). At most `perNode` suggestions per note.
 */
export function computeGhostEdges(
  vectors: DocVector[],
  linked: Set<string>,
  thresholdFor: (embedder: string) => number,
  perNode = 3,
): GhostEdge[] {
  const vs = vectors.slice(0, MAX_GHOST_DOCS);
  const pairKey = (x: string, y: string) => (x < y ? `${x}|${y}` : `${y}|${x}`);
  const cand: GhostEdge[] = [];
  for (let i = 0; i < vs.length; i++) {
    for (let j = i + 1; j < vs.length; j++) {
      const a = vs[i]!,
        b = vs[j]!;
      if (a.embedder !== b.embedder) continue;
      if (linked.has(pairKey(a.docId, b.docId))) continue;
      const score = cosine(a.vector, b.vector);
      if (score >= thresholdFor(a.embedder))
        cand.push({ a: a.docId, b: b.docId, score });
    }
  }
  cand.sort((x, y) => y.score - x.score);
  const used = new Map<string, number>();
  const out: GhostEdge[] = [];
  for (const e of cand) {
    if ((used.get(e.a) ?? 0) >= perNode || (used.get(e.b) ?? 0) >= perNode)
      continue;
    used.set(e.a, (used.get(e.a) ?? 0) + 1);
    used.set(e.b, (used.get(e.b) ?? 0) + 1);
    out.push(e);
  }
  return out;
}

export { pairKeyOf };
function pairKeyOf(x: string, y: string) {
  return x < y ? `${x}|${y}` : `${y}|${x}`;
}
