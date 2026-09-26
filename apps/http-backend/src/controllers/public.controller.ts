import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import {
  referencesOf,
  renderPublicHtml,
  snippetOf,
  stateToJson,
} from "../publish/render.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const notFound = (res: Response) =>
  res.status(404).json(new ApiResponse(404, null, "Not found"));

/** A note is readable without login only when it is explicitly public. Private notes look like missing ones. */
async function publicNote(docId: string) {
  if (!UUID.test(docId)) return null;
  const c = await prisma.content.findUnique({ where: { id: docId } });
  return c && c.type === "document" && c.isPublic ? c : null;
}

export const getPublicNote = asyncHandler(
  async (req: Request, res: Response) => {
    const c = await publicNote(String(req.params.docId ?? ""));
    if (!c) return notFound(res);

    const row = await prisma.document.findUnique({
      where: { id: c.id },
      select: { state: true, updatedAt: true },
    });
    const json = stateToJson(row?.state ?? new Uint8Array());
    const refs = referencesOf(json);

    const [publicNotes, atts] = await Promise.all([
      c.workspaceId && refs.titles.length > 0
        ? prisma.content.findMany({
            where: {
              workspaceId: c.workspaceId,
              isPublic: true,
              type: "document",
            },
            select: { id: true, title: true },
            take: 1000,
          })
        : Promise.resolve([] as { id: string; title: string }[]),
      refs.attachmentIds.length > 0
        ? prisma.attachment.findMany({
            where: { id: { in: refs.attachmentIds }, docId: c.id },
            select: { id: true },
          })
        : Promise.resolve([] as { id: string }[]),
    ]);

    const publicTitles = new Map<string, string>();
    for (const n of publicNotes)
      if (!publicTitles.has(n.title.toLowerCase()))
        publicTitles.set(n.title.toLowerCase(), n.id);

    const html = renderPublicHtml(json, {
      docId: c.id,
      publicTitles,
      attachmentIds: new Set(atts.map((a) => a.id)),
    });

    // Revalidate every time so an unpublished note disappears immediately.
    res.setHeader("Cache-Control", "no-cache");
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          id: c.id,
          title: c.title,
          html,
          description: snippetOf(json),
          updatedAt: (row?.updatedAt ?? c.updatedAt).getTime(),
        },
        "Public note",
      ),
    );
  },
);

/** Serve an image/PDF that belongs to a public note. */
export const getPublicAttachment = asyncHandler(
  async (req: Request, res: Response) => {
    const c = await publicNote(String(req.params.docId ?? ""));
    const id = String(req.params.attachmentId ?? "");
    if (!c || !UUID.test(id)) return notFound(res);
    const att = await prisma.attachment.findFirst({
      where: { id, docId: c.id },
    });
    if (!att || !/^(image\/|application\/pdf$)/.test(att.mime))
      return notFound(res);
    res.setHeader("Content-Type", att.mime);
    res.setHeader("Content-Length", String(att.size));
    res.setHeader(
      "Content-Disposition",
      `inline; filename="${att.name.replace(/[^\w.\- ]/g, "_")}"`,
    );
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Cache-Control", "public, max-age=300");
    if (att.mime !== "application/pdf") {
      res.setHeader(
        "Content-Security-Policy",
        "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:",
      );
    }
    return res.status(200).end(Buffer.from(att.data));
  },
);
