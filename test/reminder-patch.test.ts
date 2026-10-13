import { describe, expect, it } from "vitest";

import { Prisma } from "@/generated/prisma/client";
import {
  buildReminderCreate,
  buildReminderPatch,
  type ReminderUpdateData,
} from "@/lib/notifications/reminder-patch";
import type { ReminderCreateInput, ReminderUpdateInput } from "@/lib/validation/schemas";

/**
 * Reminder create/update payloads.
 *
 * The theme is that Prisma treats three states as different instructions -
 * "field absent", "field is null" and "field has a value" - and the two first
 * ones are indistinguishable by looking at a value. A missing key leaves the
 * column alone. A key present with `undefined` *also* leaves the column alone.
 * Only a key present with `null` clears it.
 *
 * So the bug these tests exist to prevent is not a crash or a bad request. It is
 * a 200 response that reports success while quietly doing nothing, which is the
 * hardest kind to notice and the easiest to ship: `body.recurrence ?? undefined`
 * type-checks perfectly and means "an explicit request to clear the recurrence
 * has been silently turned into no change at all".
 */

const SCHEDULED = new Date("2026-09-30T07:00:00.000Z");

function createInput(overrides: Partial<ReminderCreateInput> = {}): ReminderCreateInput {
  return {
    title: "Check the oven",
    scheduledFor: SCHEDULED,
    targetType: "CUSTOM",
    enabled: true,
    ...overrides,
  } as ReminderCreateInput;
}

function updateInput(overrides: Partial<ReminderUpdateInput> = {}): ReminderUpdateInput {
  return { ...overrides } as ReminderUpdateInput;
}

/**
 * Whether the patch would clear a column.
 *
 * Asserted the way Prisma sees it - by key presence - rather than by value,
 * because `null` and `undefined` compare unequal to each other and equal to
 * themselves respectively, and only key presence decides what Prisma does.
 */
function writes(patch: ReminderUpdateData, field: string): boolean {
  return Object.prototype.hasOwnProperty.call(patch, field);
}

describe("clearing a recurrence", () => {
  it("clears the column when the client asks for a one-off reminder", () => {
    // The regression this whole file exists for. The key has to be present, and
    // the value has to be the one Prisma reads as SQL NULL.
    const patch = buildReminderPatch(updateInput({ recurrence: null }));

    expect(writes(patch, "recurrence")).toBe(true);
    expect(patch.recurrence).toBe(Prisma.DbNull);
  });

  it("clears to SQL null rather than to the JSON literal null", () => {
    /*
     * The two are genuinely different and the wrong one is a real corruption,
     * not a style preference.
     *
     * `Prisma.JsonNull` writes the four-byte JSON literal `null` into the
     * column. The row then reads back as a column that is neither empty nor a
     * recurrence, and every later `isDue` has to cope with that: it is not
     * `null`, so the "no recurrence means a one-shot" path does not take it, and
     * it is not a valid rule, so the recurring path cannot use it either. The
     * reminder is neither delivered again nor cleanly finished.
     *
     * `Prisma.DbNull` is the honest "there is no recurrence" and is what the
     * rest of the code already treats as absence.
     */
    const patch = buildReminderPatch(updateInput({ recurrence: null }));

    expect(patch.recurrence).not.toBe(Prisma.JsonNull);
  });

  it("leaves the recurrence alone when the client did not mention it", () => {
    // A title edit must not quietly also un-schedule a weekly reminder.
    const patch = buildReminderPatch(updateInput({ title: "Renamed" }));

    expect(writes(patch, "recurrence")).toBe(false);
  });

  it("writes a supplied recurrence as given", () => {
    const recurrence = { freq: "WEEKLY" as const, interval: 2, byWeekday: [2] };
    const patch = buildReminderPatch(updateInput({ recurrence }));

    expect(patch.recurrence).toEqual(recurrence);
  });
});

describe("clearing other optional fields", () => {
  it("clears a body", () => {
    const patch = buildReminderPatch(updateInput({ body: null }));

    expect(writes(patch, "body")).toBe(true);
    expect(patch.body).toBeNull();
  });

  it("clears a target id, which is how a reminder is unlinked from its task", () => {
    const patch = buildReminderPatch(updateInput({ targetId: null }));

    expect(writes(patch, "targetId")).toBe(true);
    expect(patch.targetId).toBeNull();
  });
});

describe("target type", () => {
  it("writes both columns when the target type changes", () => {
    // `type` and `targetType` are redundant columns and there is no meaningful
    // reading of them disagreeing, so a patch that moved one and not the other
    // would leave the icon and the link pointing at different things.
    const patch = buildReminderPatch(updateInput({ targetType: "TASK" }));

    expect(patch.targetType).toBe("TASK");
    expect(patch.type).toBe("TASK");
  });

  it("leaves both columns alone when the target type is not being changed", () => {
    const patch = buildReminderPatch(updateInput({ targetId: "task_123" }));

    expect(writes(patch, "targetType")).toBe(false);
    expect(writes(patch, "type")).toBe(false);
  });
});

describe("re-queueing a reminder that already fired", () => {
  it("clears the delivery markers when the time moves", () => {
    // `isDue` reads `lastSentAt >= scheduledFor` as "already delivered". Move a
    // reminder from a slot that has already fired to one that has not, keep the
    // marker, and the reminder is permanently undeliverable - the stale
    // timestamp is also exactly what hides the reason.
    const patch = buildReminderPatch(updateInput({ scheduledFor: new Date("2026-10-01T07:00:00.000Z") }));

    expect(patch.lastSentAt).toBeNull();
    expect(patch.sentAt).toBeNull();
  });

  it("clears the delivery markers when a paused reminder is re-enabled", () => {
    const patch = buildReminderPatch(updateInput({ enabled: true }));

    expect(patch.enabled).toBe(true);
    expect(patch.lastSentAt).toBeNull();
    expect(patch.sentAt).toBeNull();
  });

  it("keeps the delivery markers when a reminder is only being paused", () => {
    // Pausing is not re-queueing. Clearing the markers here would let a paused
    // reminder look freshly unsent the moment it is resumed, which is a
    // different behaviour from the one `enabled: false` implies.
    const patch = buildReminderPatch(updateInput({ enabled: false }));

    expect(writes(patch, "lastSentAt")).toBe(false);
    expect(writes(patch, "sentAt")).toBe(false);
  });

  it("keeps the delivery markers for an edit that does not touch the schedule", () => {
    const patch = buildReminderPatch(updateInput({ title: "Renamed" }));

    expect(writes(patch, "lastSentAt")).toBe(false);
    expect(writes(patch, "sentAt")).toBe(false);
  });
});

describe("an empty patch", () => {
  it("writes nothing, so a no-op PATCH cannot disturb the row", () => {
    // Every key absent means Prisma runs an update that changes no column, which
    // is the correct outcome for a client that sent an empty object.
    expect(buildReminderPatch(updateInput())).toEqual({});
  });
});

describe("creation", () => {
  it("writes both target columns so the row can be dispatched with a link", () => {
    /*
     * `targetType` is nullable with no column default, so a create that only
     * writes `type` stores the reminder with a null target type. Everything
     * downstream then treats a task reminder as a custom one: the notification
     * gets the SYSTEM icon and, worse, no action link at all - the exact thing
     * the user asked for when they linked the reminder to a task. And because
     * the response reads `targetType` back, the UI drops the link it just
     * created. Both columns are written here so that cannot happen.
     */
    const data = buildReminderCreate(createInput({ targetType: "TASK", targetId: "task_123" }));

    expect(data.targetType).toBe("TASK");
    expect(data.type).toBe("TASK");
    expect(data.targetId).toBe("task_123");
  });

  it("stores absent optional fields as explicit nulls", () => {
    // Null rather than undefined, so the row is explicit about having no
    // recurrence instead of inheriting whatever a future column default decides.
    // The Json column needs the Prisma spelling of that, for the same reason the
    // update path does.
    const data = buildReminderCreate(createInput());

    expect(data.recurrence).toBe(Prisma.DbNull);
    expect(data.body).toBeNull();
    expect(data.targetId).toBeNull();
  });
});
