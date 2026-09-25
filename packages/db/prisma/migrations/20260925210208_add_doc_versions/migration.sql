-- CreateTable
CREATE TABLE "DocVersion" (
    "id" TEXT NOT NULL,
    "docId" TEXT NOT NULL,
    "state" BYTEA NOT NULL,
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "preview" TEXT NOT NULL DEFAULT '',
    "kind" TEXT NOT NULL DEFAULT 'auto',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DocVersion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "DocVersion_docId_createdAt_idx" ON "DocVersion"("docId", "createdAt");
