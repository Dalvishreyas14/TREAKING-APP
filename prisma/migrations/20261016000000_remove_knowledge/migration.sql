-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_goalId_fkey";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_resourceId_fkey";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_taskId_fkey";

-- DropForeignKey
ALTER TABLE "Note" DROP CONSTRAINT "Note_userId_fkey";

-- DropForeignKey
ALTER TABLE "Resource" DROP CONSTRAINT "Resource_categoryId_fkey";

-- DropForeignKey
ALTER TABLE "Resource" DROP CONSTRAINT "Resource_goalId_fkey";

-- DropForeignKey
ALTER TABLE "Resource" DROP CONSTRAINT "Resource_projectId_fkey";

-- DropForeignKey
ALTER TABLE "Resource" DROP CONSTRAINT "Resource_userId_fkey";

-- DropTable
DROP TABLE "Note";

-- DropTable
DROP TABLE "Resource";

-- DropEnum
DROP TYPE "ResourceKind";

-- DropEnum
DROP TYPE "ResourceStatus";
