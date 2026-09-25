import { asyncHandler } from "../utils/asyncHandler";
import { Request, Response } from "express";
import crypto from "crypto";
import { ApiResponse } from "../utils/ApiResponse";
import { prisma } from "@repo/db";

const nanoid = (size: number = 10) =>
  crypto
    .randomBytes(Math.ceil(size / 2))
    .toString("hex")
    .slice(0, size);

const shareBrain = asyncHandler(async (req: Request, res: Response) => {
  const userId = req.user?.id;
  if (!userId)
    return res.status(401).json(new ApiResponse(401, null, "Unauthorized"));

  const { expiry, isPublic = false } = req.body;

  // Generate new and unique share links
  const shareLink = nanoid(10);

  // Create share record in the db
  const share = await prisma.share.create({
    data: {
      userId,
      shareLink,
      expiry: expiry ? new Date(expiry) : null,
      isPublic,
    },
  });

  const shareUrl = `${process.env.FRONTEND_URL || "http://localhost:3000"}/shared/${shareLink}`;

  return res
    .status(201)
    .json(
      new ApiResponse(201, { shareUrl, share }, "Brain shared successfully"),
    );
});

const getSharedBrain = asyncHandler(async (req: Request, res: Response) => {
  const shareLink = req.params.shareLink as string;

  const share = await prisma.share.findUnique({ where: { shareLink } });

  if (!share) {
    return res
      .status(404)
      .json(new ApiResponse(404, null, "Shared brain not found"));
  }

  // check expiry
  if (share.expiry && new Date(share.expiry) < new Date()) {
    return res
      .status(410)
      .json(new ApiResponse(410, null, "Shared brain has expired"));
  }

  // Get all content for the shared brain
  const content = await prisma.content.findMany({
    where: { userId: share.userId },
    include: { tags: { select: { id: true, name: true } } },
    orderBy: { title: "asc" },
  });

  const mappedContent = content.map((c: any) => ({
    ...c,
    _id: c.id,
    tags: c.tags.map((t: any) => ({ ...t, _id: t.id })),
  }));

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { content: mappedContent, owner: share.userId },
        "Shared brain retrieved successfully",
      ),
    );
});

export { shareBrain, getSharedBrain };
