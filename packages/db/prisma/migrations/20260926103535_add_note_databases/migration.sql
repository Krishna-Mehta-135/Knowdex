-- AlterTable
ALTER TABLE "Content" ADD COLUMN     "databaseId" TEXT,
ADD COLUMN     "props" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "NoteDatabase" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '',
    "schema" JSONB NOT NULL DEFAULT '[]',
    "views" JSONB NOT NULL DEFAULT '[]',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NoteDatabase_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "NoteDatabase_workspaceId_idx" ON "NoteDatabase"("workspaceId");

-- CreateIndex
CREATE INDEX "Content_databaseId_idx" ON "Content"("databaseId");
