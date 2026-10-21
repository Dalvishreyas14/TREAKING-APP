-- CreateEnum
CREATE TYPE "StudyRepeat" AS ENUM ('NONE', 'WEEKLY', 'CUSTOM');

-- CreateEnum
CREATE TYPE "StudySessionStatus" AS ENUM ('PLANNED', 'IN_PROGRESS', 'COMPLETED', 'MISSED', 'RESCHEDULED');

-- AlterTable
ALTER TABLE "FocusSession" ADD COLUMN     "pausedAt" TIMESTAMP(3),
ADD COLUMN     "pausedSeconds" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "studySessionId" TEXT;

-- AlterTable
ALTER TABLE "HabitLog" ADD COLUMN     "studySessionId" TEXT;

-- CreateTable
CREATE TABLE "StudySeries" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "color" TEXT NOT NULL DEFAULT '#C8F751',
    "repeat" "StudyRepeat" NOT NULL DEFAULT 'WEEKLY',
    "daysOfWeek" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "startMinutes" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "reminderLeadMinutes" INTEGER,
    "habitId" TEXT,
    "categoryId" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "generatedThrough" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudySeries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "seriesId" TEXT,
    "title" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "notes" TEXT,
    "color" TEXT NOT NULL DEFAULT '#C8F751',
    "date" DATE NOT NULL,
    "startMinutes" INTEGER NOT NULL,
    "durationMinutes" INTEGER NOT NULL,
    "status" "StudySessionStatus" NOT NULL DEFAULT 'PLANNED',
    "actualMinutes" INTEGER NOT NULL DEFAULT 0,
    "reminderLeadMinutes" INTEGER,
    "habitId" TEXT,
    "categoryId" TEXT,
    "isException" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "rescheduledFromDate" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudySession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudySeriesSkip" (
    "id" TEXT NOT NULL,
    "seriesId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudySeriesSkip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StudySeries_userId_isActive_idx" ON "StudySeries"("userId", "isActive");

-- CreateIndex
CREATE INDEX "StudySeries_userId_createdAt_idx" ON "StudySeries"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "StudySeries_habitId_idx" ON "StudySeries"("habitId");

-- CreateIndex
CREATE INDEX "StudySession_userId_date_idx" ON "StudySession"("userId", "date");

-- CreateIndex
CREATE INDEX "StudySession_userId_status_idx" ON "StudySession"("userId", "status");

-- CreateIndex
CREATE INDEX "StudySession_seriesId_idx" ON "StudySession"("seriesId");

-- CreateIndex
CREATE INDEX "StudySession_habitId_idx" ON "StudySession"("habitId");

-- CreateIndex
CREATE UNIQUE INDEX "StudySession_seriesId_date_key" ON "StudySession"("seriesId", "date");

-- CreateIndex
CREATE INDEX "StudySeriesSkip_seriesId_idx" ON "StudySeriesSkip"("seriesId");

-- CreateIndex
CREATE UNIQUE INDEX "StudySeriesSkip_seriesId_date_key" ON "StudySeriesSkip"("seriesId", "date");

-- CreateIndex
CREATE INDEX "FocusSession_studySessionId_idx" ON "FocusSession"("studySessionId");

-- CreateIndex
CREATE INDEX "HabitLog_studySessionId_idx" ON "HabitLog"("studySessionId");

-- AddForeignKey
ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySeries" ADD CONSTRAINT "StudySeries_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySeries" ADD CONSTRAINT "StudySeries_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySeries" ADD CONSTRAINT "StudySeries_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "StudySeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySession" ADD CONSTRAINT "StudySession_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "Category"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudySeriesSkip" ADD CONSTRAINT "StudySeriesSkip_seriesId_fkey" FOREIGN KEY ("seriesId") REFERENCES "StudySeries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FocusSession" ADD CONSTRAINT "FocusSession_studySessionId_fkey" FOREIGN KEY ("studySessionId") REFERENCES "StudySession"("id") ON DELETE SET NULL ON UPDATE CASCADE;
