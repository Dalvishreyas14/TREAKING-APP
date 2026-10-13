-- Repair reminders whose `targetType` is NULL.
--
-- `Reminder` has two columns holding the same enum: `type` and `targetType`.
-- There is no meaningful reading of them disagreeing - "this reminder's type is
-- TASK but its target type is CUSTOM" is not a state any reader handles - and the
-- reason the newer column exists at all is that older rows were written before
-- it did.
--
-- It is nullable with no default, so any path that writes only `type` leaves it
-- NULL, and the dispatcher reads `targetType` to decide both the notification
-- icon and whether the notification has an action link. A NULL target therefore
-- dispatches as SYSTEM with no link at all, which is why a reminder explicitly
-- pointed at a task could arrive looking like an anonymous system message.
--
-- Copying `type` across is safe precisely because the two columns cannot
-- legitimately differ: where `targetType` is set, the code always writes both
-- together, so the only rows this touches are the ones that were never set.
UPDATE "Reminder"
SET "targetType" = "type"
WHERE "targetType" IS NULL;
