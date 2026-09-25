import { Request, Response } from "express";
import { prisma } from "@repo/db";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { isMember } from "../semantic/search.js";
import {
  convertMarkdown,
  folderFromPath,
  jsonToYState,
} from "../import/convert.js";

const MAX_FILES = 300;
const MAX_FILE_CHARS = 500_000;

const importSchema = z.object({
  workspaceId: z.string().uuid(),
  files: z
    .array(
      z.object({
        /** Path inside the export, e.g. "Folder/Note.md". Used for title + folder. */
        path: z.string().min(1).max(500),
        markdown: z.string().max(MAX_FILE_CHARS),
      }),
    )
    .min(1)
    .max(MAX_FILES),
});

/**
 * Bulk-create notes from Markdown (Obsidian vaults, Notion exports, plain .md).
 * Content is converted server-side straight to the persisted Y.Doc state, so
 * nothing has to be opened in an editor; the indexer picks the notes up
 * automatically and [[wiki links]] become real backlinks.
 */
export const importNotes = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId)
    return res.status(401).json(new ApiResponse(401, null, "Unauthorized"));
  const parsed = importSchema.safeParse(req.body);
  if (!parsed.success)
    return res
      .status(400)
      .json(new ApiResponse(400, null, "Invalid import payload"));
  const { workspaceId, files } = parsed.data;
  if (!(await isMember(userId, workspaceId))) {
    return res.status(403).json(new ApiResponse(403, null, "Forbidden"));
  }

  const created: { id: string; title: string; links: string[] }[] = [];
  const failed: { path: string; error: string }[] = [];

  for (const f of files) {
    try {
      const note = convertMarkdown(f.markdown, f.path);
      const c = await prisma.content.create({
        data: {
          title: note.title,
          link: "https://internal.doc",
          type: "document",
          userId,
          workspaceId,
          folderPath: folderFromPath(f.path),
          tags: {
            connectOrCreate: note.tags.map((name) => ({
              where: { name },
              create: { name },
            })),
          },
        },
      });
      await prisma.document.create({
        data: { id: c.id, state: Buffer.from(jsonToYState(note.json)) },
      });
      created.push({ id: c.id, title: note.title, links: note.links });
    } catch (e) {
      failed.push({
        path: f.path,
        error: e instanceof Error ? e.message : "conversion failed",
      });
    }
  }

  // Resolve [[titles]] against every note in the workspace (case-insensitive).
  const all = await prisma.content.findMany({
    where: { workspaceId, type: "document" },
    select: { id: true, title: true },
  });
  const byTitle = new Map<string, string>();
  for (const n of all)
    if (!byTitle.has(n.title.toLowerCase()))
      byTitle.set(n.title.toLowerCase(), n.id);
  const linkRows: { fromDocId: string; toDocId: string }[] = [];
  for (const n of created) {
    for (const t of n.links) {
      const to = byTitle.get(t.toLowerCase());
      if (to && to !== n.id) linkRows.push({ fromDocId: n.id, toDocId: to });
    }
  }
  if (linkRows.length > 0) {
    // Link targets need a Document row (FK); notes created above already have one,
    // pre-existing notes may not yet.
    const targets = [...new Set(linkRows.map((l) => l.toDocId))];
    await prisma.document.createMany({
      data: targets.map((id) => ({ id, state: new Uint8Array() })),
      skipDuplicates: true,
    });
    await prisma.documentLink.createMany({
      data: linkRows,
      skipDuplicates: true,
    });
  }

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        created: created.map(({ id, title }) => ({ id, title })),
        failed,
        links: linkRows.length,
      },
      `Imported ${created.length} note(s)`,
    ),
  );
});
