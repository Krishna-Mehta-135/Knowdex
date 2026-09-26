import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { embedderByName } from "../semantic/embedder.js";
import { loadDocVectors } from "../semantic/index-cache.js";
import { computeGhostEdges, isMember, pairKeyOf } from "../semantic/search.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Everything the Home screen needs in one small request: counts, recently
 * edited notes with a snippet, top suggested connections and databases. This
 * replaces downloading every note just to pick one.
 */
export const getHome = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  const wid = String(req.params.workspaceId ?? "");
  if (!userId)
    return res.status(401).json(new ApiResponse(401, null, "Unauthorized"));
  if (!UUID.test(wid))
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Invalid workspaceId"));
  if (!(await isMember(userId, wid)))
    return res.status(403).json(new ApiResponse(403, null, "Forbidden"));

  const [notes, links, files, databases, recent, tags] = await Promise.all([
    prisma.content.count({ where: { workspaceId: wid, type: "document" } }),
    prisma.$queryRaw<
      { n: bigint }[]
    >`SELECT COUNT(*)::bigint AS n FROM "DocumentLink" l JOIN "Content" c ON c.id = l."fromDocId" WHERE c."workspaceId" = ${wid}`,
    prisma.attachment.count({ where: { workspaceId: wid } }),
    prisma.noteDatabase.findMany({
      where: { workspaceId: wid },
      orderBy: { createdAt: "asc" },
      select: { id: true, name: true, icon: true },
    }),
    prisma.content.findMany({
      where: { workspaceId: wid, type: "document", databaseId: null },
      orderBy: { updatedAt: "desc" },
      take: 8,
      select: {
        id: true,
        title: true,
        updatedAt: true,
        folderPath: true,
        databaseId: true,
        tags: { select: { name: true } },
      },
    }),
    prisma.tag.count({ where: { contents: { some: { workspaceId: wid } } } }),
  ]);

  const recentIds = recent.map((r) => r.id);
  const [firstChunks, rowCounts] = await Promise.all([
    prisma.docChunk.findMany({
      where: { sourceId: { in: recentIds }, idx: 0 },
      select: { sourceId: true, text: true },
    }),
    prisma.content.groupBy({
      by: ["databaseId"],
      where: { databaseId: { in: databases.map((d) => d.id) } },
      _count: { _all: true },
    }),
  ]);
  const snippetOf = new Map(
    firstChunks.map((c) => {
      // Drop the title line the indexer prepends; keep the first sentence(s) of the body.
      const body = c.text
        .split("\n")
        .slice(1)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      return [c.sourceId, body.slice(0, 140)] as const;
    }),
  );
  const rowCountOf = new Map(
    rowCounts.map((r) => [r.databaseId, r._count._all]),
  );

  // Suggested connections (similar but unlinked), best few.
  const vectors = await loadDocVectors(wid);
  let suggestions: {
    a: string;
    b: string;
    aTitle: string;
    bTitle: string;
    score: number;
  }[] = [];
  if (vectors.length > 1) {
    const linkRows = await prisma.documentLink.findMany({
      where: { fromDocId: { in: vectors.map((v) => v.docId) } },
      select: { fromDocId: true, toDocId: true },
    });
    const linked = new Set(
      linkRows.map((l) => pairKeyOf(l.fromDocId, l.toDocId)),
    );
    const edges = computeGhostEdges(
      vectors,
      linked,
      (name) => embedderByName(name)?.ghostThreshold ?? 0.3,
    ).slice(0, 12);
    const ids = [...new Set(edges.flatMap((e) => [e.a, e.b]))];
    const titles = await prisma.content.findMany({
      where: { id: { in: ids }, type: "document", workspaceId: wid },
      select: { id: true, title: true },
    });
    const titleOf = new Map(titles.map((t) => [t.id, t.title]));
    suggestions = edges
      .filter((e) => titleOf.has(e.a) && titleOf.has(e.b))
      .slice(0, 4)
      .map((e) => ({
        a: e.a,
        b: e.b,
        aTitle: titleOf.get(e.a)!,
        bTitle: titleOf.get(e.b)!,
        score: Math.round(e.score * 1000) / 1000,
      }));
  }

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        counts: {
          notes,
          links: Number(links[0]?.n ?? 0),
          files,
          databases: databases.length,
          tags,
        },
        recent: recent.map((r) => ({
          id: r.id,
          title: r.title,
          updatedAt: r.updatedAt.getTime(),
          folderPath: r.folderPath,
          isRow: Boolean(r.databaseId),
          tags: r.tags.map((t) => t.name).slice(0, 3),
          snippet: snippetOf.get(r.id) ?? "",
        })),
        suggestions,
        databases: databases.map((d) => ({
          ...d,
          rowCount: rowCountOf.get(d.id) ?? 0,
        })),
      },
      "Home",
    ),
  );
});
