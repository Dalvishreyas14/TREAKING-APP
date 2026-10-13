-- CreateEnum
CREATE TYPE "ResourceKind" AS ENUM ('BOOK', 'COURSE', 'ARTICLE', 'VIDEO', 'PODCAST', 'PAPER', 'TOOL', 'OTHER');

-- CreateEnum
CREATE TYPE "ResourceStatus" AS ENUM ('WANTING', 'IN_PROGRESS', 'ON_HOLD', 'FINISHED', 'DROPPED');

-- AlterTable
ALTER TABLE "FocusSession" ADD COLUMN     "projectId" TEXT;

-- AlterTable
ALTER TABLE "Project" ADD COLUMN     "goalId" TEXT;

-- AlterTable
ALTER TABLE "RoutineItem" ADD COLUMN     "taskId" TEXT;

-- CreateTable
CREATE TABLE "Note" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL DEFAULT '',
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "taskId" TEXT,
    "goalId" TEXT,
    "projectId" TEXT,
    "categoryId" TEXT,
    "resourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Note_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Resource" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "kind" "ResourceKind" NOT NULL DEFAULT 'OTHER',
    "status" "ResourceStatus" NOT NULL DEFAULT 'WANTING',
    "url" TEXT,
    "author" TEXT,
    "summary" TEXT,
    "progress" INTEGER NOT NULL DEFAULT 0,
    "rating" INTEGER,
    "startedAt" TIMESTAMP(3),
    "finishedAt" TIMESTAMP(3),
    "goalId" TEXT,
    "projectId" TEXT,
    "categoryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Resource_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Note_userId_updatedAt_idx" ON "Note"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Note_userId_pinned_idx" ON "Note"("userId", "pinned");

-- CreateIndex
CREATE INDEX "Note_resourceId_idx" ON "Note"("resourceId");

-- CreateIndex
CREATE INDEX "Note_taskId_idx" ON "Note"("taskId");

-- CreateIndex
CREATE INDEX "Note_goalId_idx" ON "Note"("goalId");

-- CreateIndex
CREATE INDEX "Note_projectId_idx" ON "Note"("projectId");

-- CreateIndex
CREATE INDEX "Resource_userId_status_idx" ON "Resource"("userId", "status");

-- CreateIndex
CREATE INDEX "Resource_userId_kind_idx" ON "Resource"("userId", "kind");

-- CreateIndex
CREATE INDEX "Resource_userId_updatedAt_idx" ON "Resource"("userId", "updatedAt");

-- CreateIndex
CREATE INDEX "Resource_goalId_idx" ON "Resource"("goalId");

-- CreateIndex
CREATE INDEX "Resource_projectId_idx" ON "Resource"("projectId");

-- CreateIndex
CREATE INDEX "FocusSession_projectId_idx" ON "FocusSession"("projectId");

-- CreateIndex
CREATE INDEX "Project_goalId_idx" ON "Project"("goalId");

-- CreateIndex
CREATE INDEX "RoutineItem_taskId_idx" ON "RoutineItem"("taskId");

-- AddForeignKey
ALTER TABLE "Project" ADD CONSTRAINT "Project_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutineItem" ADD CONSTRAINT "RoutineItem_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Note" ADD CONSTRAINT "Note_resourceId_fkey" FOREIGN KEY ("resourceId") REFERENCES "Resource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Resource" ADD CONSTRAINT "Resource_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: Project.goalId, derived from the tasks already attached to each project.
--
-- A project only gets a goal where its tasks agree on exactly one. A project
-- whose tasks span two goals is left NULL on purpose: guessing would surface a
-- real but wrong number, whereas NULL is visible and fixable by hand. Grouped by
-- user as well as project so a row can never be attributed across accounts.
UPDATE "Project" p
SET "goalId" = agg."goalId"
FROM (
    SELECT pt."userId", pt."projectId", MIN(t."goalId") AS "goalId"
    FROM "ProjectTask" pt
    JOIN "Task" t ON t."id" = pt."taskId"
    WHERE t."goalId" IS NOT NULL
    GROUP BY pt."userId", pt."projectId"
    HAVING COUNT(DISTINCT t."goalId") = 1
) agg
WHERE p."id" = agg."projectId"
  AND p."userId" = agg."userId"
  AND p."goalId" IS NULL;

-- Backfill: FocusSession.projectId, resolved through the session's task.
-- Same rule as above: only where the task belongs to exactly one project.
UPDATE "FocusSession" fs
SET "projectId" = agg."projectId"
FROM (
    SELECT pt."userId", pt."taskId", MIN(pt."projectId") AS "projectId"
    FROM "ProjectTask" pt
    GROUP BY pt."userId", pt."taskId"
    HAVING COUNT(DISTINCT pt."projectId") = 1
) agg
WHERE fs."taskId" = agg."taskId"
  AND fs."userId" = agg."userId"
  AND fs."projectId" IS NULL;
