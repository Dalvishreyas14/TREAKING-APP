-- Give a routine step control over whether running it produces a task.
--
-- `taskId` alone cannot express this: it records *which* task a step maps to once
-- one exists, so a step that has never been run has nothing to point at. Defaulting
-- to true means existing routines start producing tasks without the user opting
-- in, which is the point of the feature; the per-step toggle is there for the
-- steps that are a ritual rather than a piece of work ("drink a glass of water"
-- is not something that should appear on a task list).
ALTER TABLE "RoutineItem" ADD COLUMN "createsTask" BOOLEAN NOT NULL DEFAULT true;
