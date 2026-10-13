-- CreateEnum
CREATE TYPE "WeeklyPlanCategory" AS ENUM ('STUDY', 'FITNESS', 'PERSONAL', 'WORK', 'PROJECT', 'CUSTOM');

-- CreateEnum
CREATE TYPE "WeeklyPlanTargetType" AS ENUM ('HOURS', 'SESSIONS', 'TASKS', 'COUNT');

-- CreateEnum
CREATE TYPE "WeeklyPlanStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ARCHIVED');

-- AlterTable
ALTER TABLE "WeeklyReview" ADD COLUMN     "nextWeekFocus" TEXT,
ADD COLUMN     "shouldImprove" TEXT,
ADD COLUMN     "wentWell" TEXT;

-- CreateTable
CREATE TABLE "WeeklyPlan" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" "WeeklyPlanCategory" NOT NULL DEFAULT 'CUSTOM',
    "targetType" "WeeklyPlanTargetType" NOT NULL DEFAULT 'HOURS',
    "targetValue" DOUBLE PRECISION NOT NULL,
    "status" "WeeklyPlanStatus" NOT NULL DEFAULT 'ACTIVE',
    "startDate" DATE NOT NULL,
    "endDate" DATE NOT NULL,
    "goalId" TEXT,
    "projectId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyPlanTask" (
    "weeklyPlanId" TEXT NOT NULL,
    "taskId" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyPlanTask_pkey" PRIMARY KEY ("weeklyPlanId","taskId")
);

-- CreateTable
CREATE TABLE "WeeklyPlanHabit" (
    "weeklyPlanId" TEXT NOT NULL,
    "habitId" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WeeklyPlanHabit_pkey" PRIMARY KEY ("weeklyPlanId","habitId")
);

-- CreateTable
CREATE TABLE "WeeklyPlanDay" (
    "id" TEXT NOT NULL,
    "weeklyPlanId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "note" TEXT,

    CONSTRAINT "WeeklyPlanDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WeeklyPlanTemplate" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "WeeklyPlanCategory" NOT NULL DEFAULT 'CUSTOM',
    "configuration" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WeeklyPlanTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WeeklyPlan_userId_startDate_idx" ON "WeeklyPlan"("userId", "startDate");

-- CreateIndex
CREATE INDEX "WeeklyPlan_userId_status_idx" ON "WeeklyPlan"("userId", "status");

-- CreateIndex
CREATE INDEX "WeeklyPlan_goalId_idx" ON "WeeklyPlan"("goalId");

-- CreateIndex
CREATE INDEX "WeeklyPlan_projectId_idx" ON "WeeklyPlan"("projectId");

-- CreateIndex
CREATE INDEX "WeeklyPlanTask_taskId_idx" ON "WeeklyPlanTask"("taskId");

-- CreateIndex
CREATE INDEX "WeeklyPlanHabit_habitId_idx" ON "WeeklyPlanHabit"("habitId");

-- CreateIndex
CREATE INDEX "WeeklyPlanDay_weeklyPlanId_idx" ON "WeeklyPlanDay"("weeklyPlanId");

-- CreateIndex
CREATE UNIQUE INDEX "WeeklyPlanDay_weeklyPlanId_dayOfWeek_key" ON "WeeklyPlanDay"("weeklyPlanId", "dayOfWeek");

-- CreateIndex
CREATE INDEX "WeeklyPlanTemplate_userId_createdAt_idx" ON "WeeklyPlanTemplate"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "WeeklyPlan" ADD CONSTRAINT "WeeklyPlan_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlan" ADD CONSTRAINT "WeeklyPlan_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "Goal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlan" ADD CONSTRAINT "WeeklyPlan_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlanTask" ADD CONSTRAINT "WeeklyPlanTask_weeklyPlanId_fkey" FOREIGN KEY ("weeklyPlanId") REFERENCES "WeeklyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlanTask" ADD CONSTRAINT "WeeklyPlanTask_taskId_fkey" FOREIGN KEY ("taskId") REFERENCES "Task"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlanHabit" ADD CONSTRAINT "WeeklyPlanHabit_weeklyPlanId_fkey" FOREIGN KEY ("weeklyPlanId") REFERENCES "WeeklyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlanHabit" ADD CONSTRAINT "WeeklyPlanHabit_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlanDay" ADD CONSTRAINT "WeeklyPlanDay_weeklyPlanId_fkey" FOREIGN KEY ("weeklyPlanId") REFERENCES "WeeklyPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WeeklyPlanTemplate" ADD CONSTRAINT "WeeklyPlanTemplate_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
