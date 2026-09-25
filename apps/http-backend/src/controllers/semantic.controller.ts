import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { retrieveSources, streamAnswer } from "../semantic/ask.js";
import { indexSource } from "../semantic/indexer.js";
import { embedderByName } from "../semantic/embedder.js";
import {
  computeGhostEdges,
  docVectors,
  isMember,
  nearestDocs,
  pairKeyOf,
  searchChunks,
} from "../semantic/search.js";
import {
  assertPublicUrl,
  safeFetchText,
  UnsafeUrlError,
} from "../semantic/safe-fetch.js";
import { htmlToMarkdown } from "../semantic/clip.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = (res: Response, code: number, msg: string) =>
  res.status(code).json(new ApiResponse(code, null, msg));

async function requireWorkspace(
  req: Request,
  res: Response,
): Promise<string | null> {
  const userId = req.user?.id;
  const wid = String(req.params.workspaceId ?? "");
  if (!userId) {
    fail(res, 401, "Unauthorized");
    return null;
  }
  if (!UUID.test(wid)) {
    fail(res, 400, "Invalid workspaceId");
    return null;
  }
  if (!(await isMember(userId, wid))) {
    fail(res, 403, "Forbidden");
    return null;
  }
  return wid;
}

/** Resolve a note the caller may access. */
async function requireDoc(req: Request, res: Response) {
  const userId = req.user?.id;
  const docId = String(req.params.docId ?? "");
  if (!userId) return void fail(res, 401, "Unauthorized");
  if (!UUID.test(docId)) return void fail(res, 400, "Invalid docId");
  const content = await prisma.content.findUnique({ where: { id: docId } });
  if (!content) return void fail(res, 404, "Document not found");
  if (content.workspaceId) {
    if (!(await isMember(userId, content.workspaceId)))
      return void fail(res, 403, "Forbidden");
  } else if (content.userId !== userId) {
    return void fail(res, 403, "Forbidden");
  }
  return content;
}

// ─── Graph ───────────────────────────────────────────────────────────────────

const ghostCache = new Map<
  string,
  { key: string; edges: { a: string; b: string; score: number }[] }
>();

export const getWorkspaceGraph = asyncHandler(
  async (req: Request, res: Response) => {
    const wid = await requireWorkspace(req, res);
    if (!wid) return;

    const contents = await prisma.content.findMany({
      where: { workspaceId: wid, type: "document" },
      select: {
        id: true,
        title: true,
        folderPath: true,
        createdAt: true,
        updatedAt: true,
        tags: { select: { name: true } },
      },
    });
    const ids = contents.map((c) => c.id);
    const idSet = new Set(ids);

    const [links, attachments] = await Promise.all([
      prisma.documentLink.findMany({
        where: { fromDocId: { in: ids }, toDocId: { in: ids } },
        select: { fromDocId: true, toDocId: true },
      }),
      prisma.attachment.findMany({
        where: { workspaceId: wid },
        select: {
          id: true,
          name: true,
          mime: true,
          docId: true,
          createdAt: true,
        },
      }),
    ]);

    const linked = new Set(links.map((l) => pairKeyOf(l.fromDocId, l.toDocId)));
    const vectors = (await docVectors(wid)).filter((v) => idSet.has(v.docId));
    const cacheKey = `${vectors.length}:${links.length}:${vectors.map((v) => v.vector[0]?.toFixed(4)).join(",")}`;
    let ghost = ghostCache.get(wid);
    if (!ghost || ghost.key !== cacheKey) {
      ghost = {
        key: cacheKey,
        edges: computeGhostEdges(
          vectors,
          linked,
          (name) => embedderByName(name)?.ghostThreshold ?? 0.3,
        ),
      };
      ghostCache.set(wid, ghost);
    }

    const degree = new Map<string, number>();
    for (const l of links) {
      degree.set(l.fromDocId, (degree.get(l.fromDocId) ?? 0) + 1);
      degree.set(l.toDocId, (degree.get(l.toDocId) ?? 0) + 1);
    }

    return res.status(200).json(
      new ApiResponse(
        200,
        {
          nodes: [
            ...contents.map((c) => ({
              id: c.id,
              kind: "note" as const,
              title: c.title,
              tags: c.tags.map((t) => t.name),
              folderPath: c.folderPath,
              createdAt: c.createdAt.getTime(),
              updatedAt: c.updatedAt.getTime(),
              degree: degree.get(c.id) ?? 0,
            })),
            ...attachments.map((a) => ({
              id: a.id,
              kind: "file" as const,
              title: a.name,
              tags: [] as string[],
              folderPath: "",
              createdAt: a.createdAt.getTime(),
              updatedAt: a.createdAt.getTime(),
              degree: 1,
              parentId: a.docId,
            })),
          ],
          edges: links.map((l) => ({ a: l.fromDocId, b: l.toDocId })),
          ghostEdges: ghost.edges,
        },
        "Graph fetched",
      ),
    );
  },
);

// ─── Related / mentions ──────────────────────────────────────────────────────

export const getRelated = asyncHandler(async (req: Request, res: Response) => {
  const content = await requireDoc(req, res);
  if (!content) return;
  if (!content.workspaceId)
    return res.status(200).json(new ApiResponse(200, [], "ok"));

  const vectors = await docVectors(content.workspaceId);
  const self = vectors.find((v) => v.docId === content.id);
  if (!self)
    return res.status(200).json(new ApiResponse(200, [], "Not indexed yet"));

  const near = nearestDocs(
    self,
    vectors.filter((v) => v.docId !== content.id),
    12,
  );
  const threshold =
    (embedderByName(self.embedder)?.ghostThreshold ?? 0.3) * 0.8;
  const top = near.filter((n) => n.score >= threshold).slice(0, 6);

  const [titles, links] = await Promise.all([
    prisma.content.findMany({
      where: { id: { in: top.map((t) => t.docId) }, type: "document" },
      select: { id: true, title: true },
    }),
    prisma.documentLink.findMany({
      where: {
        OR: [
          { fromDocId: content.id, toDocId: { in: top.map((t) => t.docId) } },
          { toDocId: content.id, fromDocId: { in: top.map((t) => t.docId) } },
        ],
      },
    }),
  ]);
  const linkedIds = new Set(links.flatMap((l) => [l.fromDocId, l.toDocId]));
  const titleOf = new Map(titles.map((t) => [t.id, t.title]));

  return res.status(200).json(
    new ApiResponse(
      200,
      top
        .filter((t) => titleOf.has(t.docId))
        .map((t) => ({
          id: t.docId,
          title: titleOf.get(t.docId)!,
          score: Math.round(t.score * 1000) / 1000,
          linked: linkedIds.has(t.docId),
        })),
      "Related notes",
    ),
  );
});

export const getUnlinkedMentions = asyncHandler(
  async (req: Request, res: Response) => {
    const content = await requireDoc(req, res);
    if (!content || !content.workspaceId) return;
    const title = content.title.trim();
    if (title.length < 3 || title.toLowerCase() === "untitled") {
      return res.status(200).json(new ApiResponse(200, [], "ok"));
    }
    const hits = await prisma.docChunk.findMany({
      where: {
        workspaceId: content.workspaceId,
        sourceType: "document",
        sourceId: { not: content.id },
        text: { contains: title, mode: "insensitive" },
      },
      select: { sourceId: true, text: true },
      take: 60,
    });
    const already = await prisma.documentLink.findMany({
      where: { toDocId: content.id },
      select: { fromDocId: true },
    });
    const alreadyLinked = new Set(already.map((l) => l.fromDocId));
    const wikiRe = new RegExp(
      `\\[\\[${title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\]\\]`,
      "i",
    );
    const bySource = new Map<string, string>();
    for (const h of hits) {
      if (alreadyLinked.has(h.sourceId) || wikiRe.test(h.text)) continue;
      if (!bySource.has(h.sourceId)) {
        const i = h.text.toLowerCase().indexOf(title.toLowerCase());
        const start = Math.max(0, i - 50);
        bySource.set(
          h.sourceId,
          (start > 0 ? "…" : "") +
            h.text.slice(start, i + title.length + 60).replace(/\n+/g, " "),
        );
      }
    }
    const titles = await prisma.content.findMany({
      where: { id: { in: [...bySource.keys()] } },
      select: { id: true, title: true },
    });
    return res.status(200).json(
      new ApiResponse(
        200,
        titles.map((t) => ({
          id: t.id,
          title: t.title,
          snippet: bySource.get(t.id) ?? "",
        })),
        "Unlinked mentions",
      ),
    );
  },
);

// ─── Search & Ask ────────────────────────────────────────────────────────────

const querySchema = z.object({ query: z.string().trim().min(1).max(500) });

export const semanticSearch = asyncHandler(
  async (req: Request, res: Response) => {
    const wid = await requireWorkspace(req, res);
    if (!wid) return;
    const parsed = querySchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Invalid query");

    const chunks = await searchChunks(wid, parsed.data.query, 20);
    const best = new Map<string, (typeof chunks)[number]>();
    for (const c of chunks) if (!best.has(c.sourceId)) best.set(c.sourceId, c);
    const top = [...best.values()].filter((c) => c.score > 0.08).slice(0, 8);

    const [contents, atts] = await Promise.all([
      prisma.content.findMany({
        where: { id: { in: top.map((t) => t.sourceId) } },
        select: { id: true, title: true },
      }),
      prisma.attachment.findMany({
        where: { id: { in: top.map((t) => t.sourceId) } },
        select: { id: true, name: true, docId: true },
      }),
    ]);
    const cMap = new Map(contents.map((c) => [c.id, c.title]));
    const aMap = new Map(atts.map((a) => [a.id, a]));
    return res.status(200).json(
      new ApiResponse(
        200,
        top.flatMap((t) => {
          const title = cMap.get(t.sourceId) ?? aMap.get(t.sourceId)?.name;
          if (!title) return [];
          const att = aMap.get(t.sourceId);
          return [
            {
              id: att?.docId ?? t.sourceId,
              title,
              kind: att ? "file" : "note",
              snippet: t.text.slice(0, 160).replace(/\n+/g, " "),
              score: Math.round(t.score * 1000) / 1000,
            },
          ];
        }),
        "Search results",
      ),
    );
  },
);

export const askWorkspace = asyncHandler(
  async (req: Request, res: Response) => {
    const wid = await requireWorkspace(req, res);
    if (!wid) return;
    const parsed = z
      .object({ question: z.string().trim().min(1).max(1000) })
      .safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Invalid question");

    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    const send = (event: string, data: unknown) =>
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);

    const abort = new AbortController();
    res.on("close", () => abort.abort());

    try {
      const { sources, chunks } = await retrieveSources(
        wid,
        parsed.data.question,
      );
      send("sources", sources);
      let mode = "extractive";
      for await (const part of streamAnswer(
        parsed.data.question,
        sources,
        chunks,
        abort.signal,
      )) {
        mode = part.mode;
        send("token", { text: part.token });
      }
      send("done", { mode });
    } catch (e) {
      send("error", { message: e instanceof Error ? e.message : "Ask failed" });
    } finally {
      res.end();
    }
  },
);

export const getIndexStatus = asyncHandler(
  async (req: Request, res: Response) => {
    const wid = await requireWorkspace(req, res);
    if (!wid) return;
    const [total, indexed, embedders] = await Promise.all([
      prisma.content.count({ where: { workspaceId: wid, type: "document" } }),
      prisma.docChunk.groupBy({
        by: ["sourceId"],
        where: { workspaceId: wid, sourceType: "document" },
      }),
      prisma.docChunk.groupBy({
        by: ["embedder"],
        where: { workspaceId: wid },
      }),
    ]);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          total,
          indexed: indexed.length,
          embedders: embedders.map((e) => e.embedder),
        },
        "ok",
      ),
    );
  },
);

// ─── Attachments ─────────────────────────────────────────────────────────────

const MAX_UPLOAD = 20 * 1024 * 1024;
const ALLOWED_MIME =
  /^(application\/pdf|image\/(png|jpe?g|gif|webp|avif)|text\/(plain|markdown|csv))$/;

async function extractPdfText(buf: Buffer): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(buf));
    const { text } = await extractText(pdf, { mergePages: true });
    return (Array.isArray(text) ? text.join("\n\n") : text).trim();
  } catch (e) {
    console.warn(
      "[attachments] pdf text extraction failed:",
      (e as Error).message,
    );
    return "";
  }
}

export const uploadAttachment = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    if (!userId) return fail(res, 401, "Unauthorized");
    const docId = String(req.query.docId ?? "");
    const name = String(req.query.name ?? "file")
      .slice(0, 200)
      .replace(/[\r\n"]/g, "_");
    const mime = String(req.headers["content-type"] ?? "")
      .split(";")[0]!
      .trim()
      .toLowerCase();
    if (!UUID.test(docId)) return fail(res, 400, "Invalid docId");
    const content = await prisma.content.findUnique({ where: { id: docId } });
    if (!content?.workspaceId) return fail(res, 404, "Document not found");
    if (!(await isMember(userId, content.workspaceId)))
      return fail(res, 403, "Forbidden");
    if (!ALLOWED_MIME.test(mime))
      return fail(res, 415, `Unsupported file type: ${mime || "unknown"}`);
    const body = req.body as Buffer;
    if (!Buffer.isBuffer(body) || body.length === 0)
      return fail(res, 400, "Empty upload");
    if (body.length > MAX_UPLOAD)
      return fail(res, 413, "File too large (max 20MB)");
    if (
      mime === "application/pdf" &&
      body.subarray(0, 5).toString("latin1") !== "%PDF-"
    ) {
      return fail(res, 400, "Not a valid PDF");
    }

    let extracted = "";
    if (mime === "application/pdf") extracted = await extractPdfText(body);
    else if (mime.startsWith("text/"))
      extracted = body.toString("utf8").slice(0, 200_000);

    const att = await prisma.attachment.create({
      data: {
        docId,
        workspaceId: content.workspaceId,
        userId,
        name,
        mime,
        size: body.length,
        data: new Uint8Array(body),
        extractedText: extracted,
      },
      select: { id: true, name: true, mime: true, size: true, docId: true },
    });

    if (extracted) {
      void indexSource({
        sourceId: att.id,
        sourceType: "attachment",
        workspaceId: content.workspaceId,
        title: name,
        text: extracted,
      }).catch((e) =>
        console.error("[attachments] index failed:", (e as Error).message),
      );
    }
    return res
      .status(201)
      .json(
        new ApiResponse(
          201,
          { ...att, hasText: extracted.length > 0 },
          "Uploaded",
        ),
      );
  },
);

export const downloadAttachment = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const id = String(req.params.attachmentId ?? "");
    if (!userId) return fail(res, 401, "Unauthorized");
    if (!UUID.test(id)) return fail(res, 400, "Invalid id");
    const att = await prisma.attachment.findUnique({ where: { id } });
    if (!att) return fail(res, 404, "Not found");
    if (!(await isMember(userId, att.workspaceId)))
      return fail(res, 403, "Forbidden");
    res.setHeader("Content-Type", att.mime);
    res.setHeader("Content-Length", String(att.size));
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${att.name.replace(/[^\w.\- ]/g, "_")}"`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "private, max-age=3600");
    // Uploaded files must never execute script in our origin. PDFs are shown by
    // the browser's viewer (which a `sandbox` CSP would disable), everything else
    // is served fully sandboxed.
    if (att.mime !== "application/pdf") {
      res.setHeader(
        "Content-Security-Policy",
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      );
    }
    return res.status(200).end(Buffer.from(att.data));
  },
);

export const deleteAttachment = asyncHandler(
  async (req: Request, res: Response) => {
    const userId = req.user?.id;
    const id = String(req.params.attachmentId ?? "");
    if (!userId) return fail(res, 401, "Unauthorized");
    if (!UUID.test(id)) return fail(res, 400, "Invalid id");
    const att = await prisma.attachment.findUnique({
      where: { id },
      select: { id: true, workspaceId: true },
    });
    if (!att) return fail(res, 404, "Not found");
    if (!(await isMember(userId, att.workspaceId)))
      return fail(res, 403, "Forbidden");
    await prisma.$transaction([
      prisma.docChunk.deleteMany({ where: { sourceId: id } }),
      prisma.docIndexState.deleteMany({ where: { sourceId: id } }),
      prisma.attachment.delete({ where: { id } }),
    ]);
    return res.status(200).json(new ApiResponse(200, null, "Deleted"));
  },
);

// ─── Web clipper ─────────────────────────────────────────────────────────────

export const clipUrl = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) return fail(res, 401, "Unauthorized");
  const parsed = z
    .object({ url: z.string().url().max(2000) })
    .safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid URL");
  try {
    await assertPublicUrl(parsed.data.url);
    const page = await safeFetchText(parsed.data.url);
    if (!/html|text\/plain/i.test(page.contentType))
      return fail(res, 415, "URL is not a web page");
    const { title, markdown, description, image } = htmlToMarkdown(page.body);
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          url: page.url,
          title,
          description,
          image,
          markdown: markdown.slice(0, 100_000),
        },
        "Clipped",
      ),
    );
  } catch (e) {
    if (e instanceof UnsafeUrlError) return fail(res, 400, e.message);
    return fail(res, 502, `Could not fetch page: ${(e as Error).message}`);
  }
});

/** Bookmark-card metadata only (title, description, image). */
export const linkPreview = asyncHandler(async (req: Request, res: Response) => {
  if (!req.user?.id) return fail(res, 401, "Unauthorized");
  const parsed = z
    .object({ url: z.string().url().max(2000) })
    .safeParse(req.body);
  if (!parsed.success) return fail(res, 400, "Invalid URL");
  try {
    const page = await safeFetchText(parsed.data.url, { maxBytes: 300_000 });
    const { title, description, image } = htmlToMarkdown(page.body);
    return res
      .status(200)
      .json(
        new ApiResponse(
          200,
          { url: page.url, title, description, image },
          "ok",
        ),
      );
  } catch (e) {
    if (e instanceof UnsafeUrlError) return fail(res, 400, e.message);
    return fail(res, 502, `Could not fetch page: ${(e as Error).message}`);
  }
});
