import { createHash } from "node:crypto";
import { prisma } from "@repo/db";
import { chunkText } from "./chunker.js";
import { embedWithFallback, preferredEmbedder } from "./embedder.js";
import { extractPlainText } from "./text.js";
import { snapshotSweep } from "./versions.js";

const hashOf = (s: string) => createHash("sha1").update(s).digest("hex");

/** (Re)build the chunk rows for one source. Returns false when nothing changed. */
export async function indexSource(args: {
  sourceId: string;
  sourceType: "document" | "attachment";
  workspaceId: string;
  title: string;
  text: string;
}): Promise<boolean> {
  const { sourceId, sourceType, workspaceId, title, text } = args;
  // Notes usually start with their title as a heading; don't index it twice.
  const startsWithTitle = text
    .trimStart()
    .toLowerCase()
    .startsWith(title.trim().toLowerCase());
  const body = (startsWithTitle ? text : `${title}\n\n${text}`).trim();
  const hash = hashOf(body);
  const prev = await prisma.docIndexState.findUnique({ where: { sourceId } });
  const embedderName = preferredEmbedder().name;

  if (prev && prev.hash === hash && prev.embedder === embedderName) {
    await prisma.docIndexState.update({
      where: { sourceId },
      data: { indexedAt: new Date() },
    });
    return false;
  }

  const chunks = chunkText(body);
  if (chunks.length === 0) {
    await prisma.$transaction([
      prisma.docChunk.deleteMany({ where: { sourceId } }),
      prisma.docIndexState.upsert({
        where: { sourceId },
        create: { sourceId, hash, embedder: embedderName },
        update: { hash, embedder: embedderName, indexedAt: new Date() },
      }),
    ]);
    return true;
  }

  // Every chunk carries the title so passages stay attributable when retrieved.
  const inputs = chunks.map((c, i) => (i === 0 ? c : `${title}: ${c}`));
  const { vectors, embedder } = await embedWithFallback(inputs, "document");

  await prisma.$transaction([
    prisma.docChunk.deleteMany({ where: { sourceId } }),
    prisma.docChunk.createMany({
      data: chunks.map((text, idx) => ({
        sourceId,
        sourceType,
        workspaceId,
        idx,
        text,
        embedding: vectors[idx]!,
        embedder: embedder.name,
      })),
    }),
    prisma.docIndexState.upsert({
      where: { sourceId },
      create: { sourceId, hash, embedder: embedder.name },
      update: { hash, embedder: embedder.name, indexedAt: new Date() },
    }),
  ]);
  return true;
}

/** Index every note whose persisted state changed since it was last indexed. */
export async function sweepIndex(limit = 10): Promise<number> {
  const contents = await prisma.content.findMany({
    where: { type: "document", workspaceId: { not: null } },
    select: { id: true, title: true, workspaceId: true },
  });
  const ids = contents.map((c) => c.id);

  // Drop chunks of notes that were deleted.
  await prisma.docChunk.deleteMany({
    where: { sourceType: "document", sourceId: { notIn: ids } },
  });

  if (ids.length === 0) return 0;
  const [docs, states] = await Promise.all([
    prisma.document.findMany({
      where: { id: { in: ids } },
      select: { id: true, updatedAt: true },
    }),
    prisma.docIndexState.findMany({ where: { sourceId: { in: ids } } }),
  ]);
  const stateById = new Map(states.map((s) => [s.sourceId, s]));
  const embedderName = preferredEmbedder().name;

  const stale = docs.filter((d) => {
    const s = stateById.get(d.id);
    return !s || d.updatedAt > s.indexedAt || s.embedder !== embedderName;
  });

  let done = 0;
  for (const d of stale.slice(0, limit)) {
    const c = contents.find((x) => x.id === d.id);
    if (!c?.workspaceId) continue;
    const row = await prisma.document.findUnique({ where: { id: d.id } });
    if (!row) continue;
    try {
      await indexSource({
        sourceId: d.id,
        sourceType: "document",
        workspaceId: c.workspaceId,
        title: c.title,
        text: extractPlainText(row.state),
      });
      done++;
      // Stay under Gemini's per-minute embedding quota during bulk (re)indexing.
      if (preferredEmbedder().name !== "local-hash-v1")
        await new Promise((r) => setTimeout(r, 700));
    } catch (e) {
      console.error(`[index] failed for ${d.id}:`, (e as Error).message);
    }
  }
  return done;
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
  const tick = async () => {
    let next = idleMs;
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
