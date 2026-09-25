import { prisma } from "@repo/db";
import { extractPlainText } from "./text.js";

const MIN_INTERVAL_MS = 5 * 60_000; // at most one auto snapshot per note per 5 min
const QUIET_MS = 30_000; // ...taken once edits have paused
const MAX_VERSIONS = 60;
const LOOKBACK_MS = 14 * 86_400_000;

const wordsIn = (t: string) => (t.match(/\S+/g) ?? []).length;

/** Store a snapshot of the note's persisted state. Returns null if the note is empty. */
export async function snapshotDocument(
  docId: string,
  kind: "auto" | "manual",
): Promise<{ id: string; createdAt: Date } | null> {
  const row = await prisma.document.findUnique({ where: { id: docId } });
  if (!row) return null;
  const text = extractPlainText(row.state);
  if (!text) return null;
  const v = await prisma.docVersion.create({
    data: {
      docId,
      state: row.state,
      wordCount: wordsIn(text),
      preview: text.replace(/\s+/g, " ").slice(0, 140),
      kind,
    },
    select: { id: true, createdAt: true },
  });
  // Keep history bounded.
  const old = await prisma.docVersion.findMany({
    where: { docId },
    orderBy: { createdAt: "desc" },
    skip: MAX_VERSIONS,
    select: { id: true },
  });
  if (old.length > 0) {
    await prisma.docVersion.deleteMany({
      where: { id: { in: old.map((o) => o.id) } },
    });
  }
  return v;
}

/** Background pass: snapshot recently-edited notes that have gone quiet. */
export async function snapshotSweep(now = Date.now()): Promise<number> {
  const recent = await prisma.document.findMany({
    where: { updatedAt: { gt: new Date(now - LOOKBACK_MS) } },
    select: { id: true, updatedAt: true },
  });
  if (recent.length === 0) return 0;
  const ids = recent.map((d) => d.id);
  const latest = await prisma.docVersion.groupBy({
    by: ["docId"],
    where: { docId: { in: ids } },
    _max: { createdAt: true },
  });
  const lastAt = new Map(
    latest.map((l) => [l.docId, l._max.createdAt?.getTime() ?? 0]),
  );

  let n = 0;
  for (const d of recent) {
    const last = lastAt.get(d.id) ?? 0;
    const changed = d.updatedAt.getTime() > last;
    const quiet = now - d.updatedAt.getTime() >= QUIET_MS;
    const spaced = now - last >= MIN_INTERVAL_MS;
    if (changed && quiet && spaced) {
      if (await snapshotDocument(d.id, "auto")) n++;
    }
  }
  return n;
}
