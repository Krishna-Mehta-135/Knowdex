import { Request, Response } from "express";
import { Prisma, prisma } from "@repo/db";
import { z } from "zod";
import { asyncHandler } from "../utils/asyncHandler";
import { ApiResponse } from "../utils/ApiResponse";
import { isMember } from "../semantic/search.js";
import {
  schemaArray,
  TEMPLATES,
  validateProps,
  viewsArray,
  type Property,
  type View,
} from "../databases/schema.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS = 5000;
const fail = (res: Response, code: number, msg: string) =>
  res.status(code).json(new ApiResponse(code, null, msg));

async function requireWorkspaceMember(
  req: Request,
  res: Response,
): Promise<string | null> {
  const userId = req.user?.id;
  const wid = String(req.params.workspaceId ?? "");
  if (!userId) return (void fail(res, 401, "Unauthorized"), null);
  if (!UUID.test(wid))
    return (void fail(res, 400, "Invalid workspaceId"), null);
  if (!(await isMember(userId, wid)))
    return (void fail(res, 403, "Forbidden"), null);
  return wid;
}

/** Load a database the caller may access. */
async function requireDatabase(req: Request, res: Response) {
  const userId = req.user?.id;
  const id = String(req.params.databaseId ?? "");
  if (!userId) return void fail(res, 401, "Unauthorized");
  if (!UUID.test(id)) return void fail(res, 400, "Invalid databaseId");
  const db = await prisma.noteDatabase.findUnique({ where: { id } });
  if (!db) return void fail(res, 404, "Database not found");
  if (!(await isMember(userId, db.workspaceId)))
    return void fail(res, 403, "Forbidden");
  return db;
}

const asSchema = (v: unknown) => v as Property[];
const asViews = (v: unknown) => v as View[];

function rowOf(c: {
  id: string;
  title: string;
  props: unknown;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: c.id,
    title: c.title,
    props: (c.props ?? {}) as Record<string, unknown>,
    createdAt: c.createdAt.getTime(),
    updatedAt: c.updatedAt.getTime(),
  };
}

const publicDb = (d: {
  id: string;
  name: string;
  icon: string;
  schema: unknown;
  views: unknown;
  workspaceId: string;
}) => ({
  id: d.id,
  name: d.name,
  icon: d.icon,
  workspaceId: d.workspaceId,
  schema: d.schema,
  views: d.views,
});

export const listDatabases = asyncHandler(
  async (req: Request, res: Response) => {
    const wid = await requireWorkspaceMember(req, res);
    if (!wid) return;
    const dbs = await prisma.noteDatabase.findMany({
      where: { workspaceId: wid },
      orderBy: { createdAt: "asc" },
    });
    const counts = await prisma.content.groupBy({
      by: ["databaseId"],
      where: { databaseId: { in: dbs.map((d) => d.id) } },
      _count: { _all: true },
    });
    const countOf = new Map(counts.map((c) => [c.databaseId, c._count._all]));
    return res.status(200).json(
      new ApiResponse(
        200,
        dbs.map((d) => ({ ...publicDb(d), rowCount: countOf.get(d.id) ?? 0 })),
        "Databases",
      ),
    );
  },
);

const createSchema = z.object({
  name: z.string().trim().min(1).max(80),
  icon: z.string().max(8).optional(),
  template: z.enum(["blank", "tasks", "reading"]).default("blank"),
});

export const createDatabase = asyncHandler(
  async (req: Request, res: Response) => {
    const wid = await requireWorkspaceMember(req, res);
    if (!wid) return;
    const parsed = createSchema.safeParse(req.body);
    if (!parsed.success) return fail(res, 400, "Invalid database");
    const t = TEMPLATES[parsed.data.template]!;
    const db = await prisma.noteDatabase.create({
      data: {
        workspaceId: wid,
        name: parsed.data.name,
        icon: parsed.data.icon ?? "",
        schema: t.schema as unknown as Prisma.InputJsonValue,
        views: t.views as unknown as Prisma.InputJsonValue,
        createdBy: req.user!.id,
      },
    });
    return res
      .status(201)
      .json(new ApiResponse(201, publicDb(db), "Database created"));
  },
);

export const getDatabase = asyncHandler(async (req: Request, res: Response) => {
  const db = await requireDatabase(req, res);
  if (!db) return;
  const rows = await prisma.content.findMany({
    where: { databaseId: db.id, type: "document" },
    orderBy: { createdAt: "asc" },
    take: MAX_ROWS,
    select: {
      id: true,
      title: true,
      props: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { database: publicDb(db), rows: rows.map(rowOf) },
        "Database",
      ),
    );
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(80).optional(),
  icon: z.string().max(8).optional(),
  schema: schemaArray.optional(),
  views: viewsArray.optional(),
});

export const updateDatabase = asyncHandler(
  async (req: Request, res: Response) => {
    const db = await requireDatabase(req, res);
    if (!db) return;
    const parsed = patchSchema.safeParse(req.body);
    if (!parsed.success) {
      return fail(
        res,
        400,
        parsed.error.issues[0]?.message ?? "Invalid update",
      );
    }
    const { name, icon, schema, views } = parsed.data;
    // Views may only reference properties that exist.
    const props = new Set((schema ?? asSchema(db.schema)).map((p) => p.id));
    for (const v of views ?? []) {
      if (v.groupBy && !props.has(v.groupBy))
        return fail(res, 400, `view "${v.name}" groups by an unknown property`);
      if (v.type === "board" && !v.groupBy)
        return fail(
          res,
          400,
          `board view "${v.name}" needs a group-by property`,
        );
    }
    const updated = await prisma.noteDatabase.update({
      where: { id: db.id },
      data: {
        ...(name !== undefined && { name }),
        ...(icon !== undefined && { icon }),
        ...(schema && { schema: schema as unknown as Prisma.InputJsonValue }),
        ...(views && { views: views as unknown as Prisma.InputJsonValue }),
      },
    });
    return res
      .status(200)
      .json(new ApiResponse(200, publicDb(updated), "Database updated"));
  },
);

/** Deleting a database keeps its notes (they just stop being rows). */
export const deleteDatabase = asyncHandler(
  async (req: Request, res: Response) => {
    const db = await requireDatabase(req, res);
    if (!db) return;
    await prisma.$transaction([
      prisma.content.updateMany({
        where: { databaseId: db.id },
        data: { databaseId: null, props: {} },
      }),
      prisma.noteDatabase.delete({ where: { id: db.id } }),
    ]);
    return res.status(200).json(new ApiResponse(200, null, "Database deleted"));
  },
);

const rowSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  props: z.record(z.string(), z.unknown()).optional(),
});

export const createRow = asyncHandler(async (req: Request, res: Response) => {
  const db = await requireDatabase(req, res);
  if (!db) return;
  const parsed = rowSchema.safeParse(req.body ?? {});
  if (!parsed.success) return fail(res, 400, "Invalid row");
  const check = validateProps(asSchema(db.schema), parsed.data.props ?? {});
  if (!check.ok) return fail(res, 400, check.errors.join("; "));
  if (
    (await prisma.content.count({ where: { databaseId: db.id } })) >= MAX_ROWS
  ) {
    return fail(res, 400, `A database can hold at most ${MAX_ROWS} rows`);
  }
  const row = await prisma.content.create({
    data: {
      title: parsed.data.title ?? "Untitled",
      link: "https://internal.doc",
      type: "document",
      userId: req.user!.id,
      workspaceId: db.workspaceId,
      databaseId: db.id,
      props: check.value as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      title: true,
      props: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return res.status(201).json(new ApiResponse(201, rowOf(row), "Row created"));
});

export const updateRow = asyncHandler(async (req: Request, res: Response) => {
  const db = await requireDatabase(req, res);
  if (!db) return;
  const rowId = String(req.params.rowId ?? "");
  if (!UUID.test(rowId)) return fail(res, 400, "Invalid rowId");
  const existing = await prisma.content.findFirst({
    where: { id: rowId, databaseId: db.id },
  });
  if (!existing) return fail(res, 404, "Row not found");
  const parsed = rowSchema.safeParse(req.body ?? {});
  if (!parsed.success) return fail(res, 400, "Invalid row");
  const check = validateProps(asSchema(db.schema), parsed.data.props ?? {});
  if (!check.ok) return fail(res, 400, check.errors.join("; "));
  const merged = {
    ...((existing.props ?? {}) as Record<string, unknown>),
    ...check.value,
  };
  // null clears a value; drop the key so the JSON stays small.
  for (const k of Object.keys(merged)) if (merged[k] === null) delete merged[k];
  const row = await prisma.content.update({
    where: { id: rowId },
    data: {
      ...(parsed.data.title !== undefined && { title: parsed.data.title }),
      props: merged as Prisma.InputJsonValue,
    },
    select: {
      id: true,
      title: true,
      props: true,
      createdAt: true,
      updatedAt: true,
    },
  });
  return res.status(200).json(new ApiResponse(200, rowOf(row), "Row updated"));
});
