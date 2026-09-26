import { createHash } from "node:crypto";
import { prisma } from "@repo/db";
import { chunkText } from "./chunker.js";
import { embedWithFallback, preferredEmbedder } from "./embedder.js";
import { extractPlainText } from "./text.js";
import { snapshotSweep } from "./versions.js";
import { bumpWorkspace } from "./index-cache.js";

const hashOf = (s: string) => createHash("sha1").update(s).digest("hex");

export interface IndexItem {
  sourceId: string;
  sourceType: "document" | "attachment";
  workspaceId: string;
  title: string;
  text: string;
}

function bodyFor(title: string, text: string): string {
  // Notes usually start with their title as a heading; don't index it twice.
  const startsWithTitle = text
    .trimStart()
    .toLowerCase()
    .startsWith(title.trim().toLowerCase());
  return (startsWithTitle ? text : `${title}\n\n${text}`).trim();
}

/**
 * (Re)build chunk rows for several sources. All chunks needing embeddings go
 * out in ONE embedder call (which itself batches 50 per request), instead of
 * a request per note. Returns how many sources actually changed.
 */
export async function indexMany(items: IndexItem[]): Promise<number> {
  if (items.length === 0) return 0;
  const embedderName = preferredEmbedder().name;
  const states = await prisma.docIndexState.findMany({
    where: { sourceId: { in: items.map((i) => i.sourceId) } },
  });
  const prevById = new Map(states.map((s) => [s.sourceId, s]));

  const touch: string[] = [];
  const work: {
    item: IndexItem;
    hash: string;
    chunks: string[];
    inputs: string[];
  }[] = [];
  for (const item of items) {
    const body = bodyFor(item.title, item.text);
    const hash = hashOf(body);
    const prev = prevById.get(item.sourceId);
    if (prev && prev.hash === hash && prev.embedder === embedderName) {
      touch.push(item.sourceId);
      continue;
    }
    const chunks = chunkText(body);
    // Every chunk carries the title so passages stay attributable when retrieved.
    const inputs = chunks.map((c, i) => (i === 0 ? c : `${item.title}: ${c}`));
    work.push({ item, hash, chunks, inputs });
  }

  if (touch.length > 0) {
    await prisma.docIndexState.updateMany({
      where: { sourceId: { in: touch } },
      data: { indexedAt: new Date() },
    });
  }
  if (work.length === 0) return 0;

  const allInputs = work.flatMap((w) => w.inputs);
  const { vectors, embedder } =
    allInputs.length > 0
      ? await embedWithFallback(allInputs, "document")
      : { vectors: [] as number[][], embedder: preferredEmbedder() };

  let offset = 0;
  const touchedWorkspaces = new Set<string>();
  for (const w of work) {
    const vs = vectors.slice(offset, offset + w.chunks.length);
    offset += w.chunks.length;
    const { sourceId, sourceType, workspaceId } = w.item;
    await prisma.$transaction([
      prisma.docChunk.deleteMany({ where: { sourceId } }),
      prisma.docChunk.createMany({
        data: w.chunks.map((text, idx) => ({
          sourceId,
          sourceType,
          workspaceId,
          idx,
          text,
          embedding: vs[idx]!,
          embedder: embedder.name,
        })),
      }),
      prisma.docIndexState.upsert({
        where: { sourceId },
        create: { sourceId, hash: w.hash, embedder: embedder.name },
        update: {
          hash: w.hash,
          embedder: embedder.name,
          indexedAt: new Date(),
        },
      }),
    ]);
    touchedWorkspaces.add(workspaceId);
  }
  for (const ws of touchedWorkspaces) bumpWorkspace(ws);
  return work.length;
}

/** Index a single source (uploads). */
export async function indexSource(item: IndexItem): Promise<boolean> {
  return (await indexMany([item])) > 0;
}

/** Remove index rows whose note/attachment no longer exists. */
export async function cleanupOrphans(): Promise<void> {
  await prisma.$executeRaw`DELETE FROM "DocChunk" ch WHERE ch."sourceType" = 'document' AND NOT EXISTS (SELECT 1 FROM "Content" c WHERE c.id = ch."sourceId")`;
  await prisma.$executeRaw`DELETE FROM "DocChunk" ch WHERE ch."sourceType" = 'attachment' AND NOT EXISTS (SELECT 1 FROM "Attachment" a WHERE a.id = ch."sourceId")`;
  await prisma.$executeRaw`DELETE FROM "DocIndexState" st WHERE NOT EXISTS (SELECT 1 FROM "Content" c WHERE c.id = st."sourceId") AND NOT EXISTS (SELECT 1 FROM "Attachment" a WHERE a.id = st."sourceId")`;
}

/**
 * Index notes whose persisted state changed since they were last indexed.
 * A single indexed query finds the stale ones — no full-table scans per tick.
 */
export async function sweepIndex(limit = 25): Promise<number> {
  const embedderName = preferredEmbedder().name;
  const stale = await prisma.$queryRaw<
    { id: string; title: string; workspaceId: string }[]
  >`SELECT c.id, c.title, c."workspaceId"
      FROM "Content" c
      JOIN "Document" d ON d.id = c.id
      LEFT JOIN "DocIndexState" s ON s."sourceId" = c.id
     WHERE c.type = 'document' AND c."workspaceId" IS NOT NULL
       AND (s."sourceId" IS NULL OR d."updatedAt" > s."indexedAt" OR s.embedder <> ${embedderName})
     ORDER BY d."updatedAt" DESC
     LIMIT ${limit}`;
  if (stale.length === 0) return 0;

  const rows = await prisma.document.findMany({
    where: { id: { in: stale.map((s) => s.id) } },
    select: { id: true, state: true },
  });
  const stateById = new Map(rows.map((r) => [r.id, r.state]));
  try {
    return await indexMany(
      stale.map((c) => ({
        sourceId: c.id,
        sourceType: "document" as const,
        workspaceId: c.workspaceId,
        title: c.title,
        text: extractPlainText(stateById.get(c.id) ?? new Uint8Array()),
      })),
    );
  } catch (e) {
    console.error("[index] batch failed:", (e as Error).message);
    return 0;
  }
}

let timer: NodeJS.Timeout | null = null;
let stopped = false;

/**
 * Background loop: drains stale notes in bursts (so a bulk import is searchable
 * within seconds) and idles at a slow poll once everything is indexed.
 */
export function startIndexer(idleMs = 15_000, burstMs = 400): void {
  if (timer || process.env.DISABLE_INDEXER === "1") return;
  stopped = false;
  let ticks = 0;
  const tick = async () => {
    let next = idleMs;
    if (ticks++ % 20 === 0) await cleanupOrphans().catch(() => undefined);
    try {
      const n = await sweepIndex(25);
      await snapshotSweep().catch((e) =>
        console.error("[versions] sweep error:", (e as Error).message),
      );
      if (n > 0) next = burstMs;
    } catch (e) {
      console.error("[index] sweep error:", (e as Error).message);
    }
    if (!stopped) {
      timer = setTimeout(() => void tick(), next);
      timer.unref();
    }
  };
  timer = setTimeout(() => void tick(), 0);
  timer.unref();
}

export function stopIndexer(): void {
  stopped = true;
  if (timer) clearTimeout(timer);
  timer = null;
}
