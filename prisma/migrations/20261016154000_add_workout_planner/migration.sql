-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "WorkoutStatus" ADD VALUE 'IN_PROGRESS';
ALTER TYPE "WorkoutStatus" ADD VALUE 'SKIPPED';
ALTER TYPE "WorkoutStatus" ADD VALUE 'RESCHEDULED';

-- AlterTable
ALTER TABLE "HabitLog" ADD COLUMN     "workoutId" TEXT;

-- AlterTable
ALTER TABLE "Workout" ADD COLUMN     "habitId" TEXT,
ADD COLUMN     "muscleGroups" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "rescheduledFromDate" DATE,
ADD COLUMN     "routineDayId" TEXT,
ADD COLUMN     "routineId" TEXT,
ADD COLUMN     "startedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "WorkoutRoutine" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "color" TEXT NOT NULL DEFAULT '#C8F751',
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "pausedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutRoutine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutRoutineDay" (
    "id" TEXT NOT NULL,
    "routineId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "muscleGroups" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isRest" BOOLEAN NOT NULL DEFAULT false,
    "targetMinutes" INTEGER,
    "startMinutes" INTEGER,
    "notes" TEXT,
    "position" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutRoutineDay_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutRoutineExercise" (
    "id" TEXT NOT NULL,
    "routineDayId" TEXT NOT NULL,
    "exerciseId" TEXT,
    "name" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "restSeconds" INTEGER,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutRoutineExercise_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorkoutRoutineSet" (
    "id" TEXT NOT NULL,
    "routineExerciseId" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "reps" INTEGER,
    "weight" DOUBLE PRECISION,
    "durationSeconds" INTEGER,
    "restSeconds" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorkoutRoutineSet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WorkoutRoutine_userId_isActive_idx" ON "WorkoutRoutine"("userId", "isActive");

-- CreateIndex
CREATE INDEX "WorkoutRoutine_userId_createdAt_idx" ON "WorkoutRoutine"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "WorkoutRoutineDay_routineId_idx" ON "WorkoutRoutineDay"("routineId");

-- CreateIndex
CREATE UNIQUE INDEX "WorkoutRoutineDay_routineId_weekday_key" ON "WorkoutRoutineDay"("routineId", "weekday");

-- CreateIndex
CREATE INDEX "WorkoutRoutineExercise_routineDayId_position_idx" ON "WorkoutRoutineExercise"("routineDayId", "position");

-- CreateIndex
CREATE INDEX "WorkoutRoutineExercise_exerciseId_idx" ON "WorkoutRoutineExercise"("exerciseId");

-- CreateIndex
CREATE INDEX "WorkoutRoutineSet_routineExerciseId_position_idx" ON "WorkoutRoutineSet"("routineExerciseId", "position");

-- CreateIndex
CREATE INDEX "HabitLog_workoutId_idx" ON "HabitLog"("workoutId");

-- CreateIndex
CREATE INDEX "Workout_userId_date_status_idx" ON "Workout"("userId", "date", "status");

-- CreateIndex
CREATE INDEX "Workout_routineId_idx" ON "Workout"("routineId");

-- CreateIndex
CREATE INDEX "Workout_routineDayId_idx" ON "Workout"("routineDayId");

-- AddForeignKey
ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_workoutId_fkey" FOREIGN KEY ("workoutId") REFERENCES "Workout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_habitId_fkey" FOREIGN KEY ("habitId") REFERENCES "Habit"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "WorkoutRoutine"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Workout" ADD CONSTRAINT "Workout_routineDayId_fkey" FOREIGN KEY ("routineDayId") REFERENCES "WorkoutRoutineDay"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutRoutine" ADD CONSTRAINT "WorkoutRoutine_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutRoutineDay" ADD CONSTRAINT "WorkoutRoutineDay_routineId_fkey" FOREIGN KEY ("routineId") REFERENCES "WorkoutRoutine"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutRoutineExercise" ADD CONSTRAINT "WorkoutRoutineExercise_routineDayId_fkey" FOREIGN KEY ("routineDayId") REFERENCES "WorkoutRoutineDay"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutRoutineExercise" ADD CONSTRAINT "WorkoutRoutineExercise_exerciseId_fkey" FOREIGN KEY ("exerciseId") REFERENCES "Exercise"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorkoutRoutineSet" ADD CONSTRAINT "WorkoutRoutineSet_routineExerciseId_fkey" FOREIGN KEY ("routineExerciseId") REFERENCES "WorkoutRoutineExercise"("id") ON DELETE CASCADE ON UPDATE CASCADE;
