import { Prisma } from "@/generated/prisma/client";
import type { ReminderCreateInput, ReminderUpdateInput } from "@/lib/validation/schemas";

/**
 * Turning a reminder PATCH body into a Prisma `data` object.
 *
 * This exists as its own module, and not as a literal in the route, because
 * "absent" and "cleared" are different instructions and Prisma spells them
 * differently: a key that is missing from `data` leaves the column alone, and a
 * key present with value `undefined` also leaves it alone. Only a key present
 * with an explicit `null` actually clears a nullable column.
 *
 * That distinction is easy to get wrong in a way the type system accepts, because
 * `recurrence: null` and `recurrence: undefined` are both assignable to an
 * optional field. Writing the mapping as `body.recurrence ?? undefined` looks
 * correct and is not: the outer guard has already established the key was sent,
 * so the `??` silently converts an explicit "make this a one-off" into "change
 * nothing". The API answers 200 and the recurrence is still there.
 *
 * So the rule here is one line long and applies to every field: if the client
 * sent the key, write the value; if the client omitted the key, write nothing.
 */
export type ReminderUpdateData = Prisma.ReminderUncheckedUpdateInput;

/**
 * The `data` for a reminder update, given what the client sent.
 *
 * `scheduledFor` and `enabled` are the two fields that carry a side effect
 * rather than a value of their own. Both are ways of re-queueing a reminder that
 * has already fired, so either one clears the delivery markers. Without that,
 * moving a reminder from 09:00 to 07:00 while its 09:00 slot was already
 * delivered would leave something `isDue` can never call due again - the
 * reminder is silently dead, and the reason is invisible because the stale
 * `lastSentAt` is what is suppressing it.
 */
export function buildReminderPatch(body: ReminderUpdateInput): ReminderUpdateData {
  const reQueues = body.scheduledFor !== undefined || body.enabled === true;

  // `Prisma.ReminderUncheckedUpdateInput` rather than a loose record, so that a
  // column renamed in the schema turns into a compile error here instead of a
  // silent no-op write at runtime.
  const data: ReminderUpdateData = {
    // `in` is the point of the whole helper: it keeps keys that were sent but
    // whose value is null, which is how a field gets cleared.
    ...(in_(body, "title") ? { title: body.title } : {}),
    ...(in_(body, "body") ? { body: body.body } : {}),
    ...(in_(body, "targetType")
      ? // Both columns, for the same reason the create path writes both: the
        // icon and the link are read from `targetType` while older rows were
        // written to `type`, so moving one without the other strands them.
        { targetType: body.targetType, type: body.targetType }
      : {}),
    ...(in_(body, "targetId") ? { targetId: body.targetId } : {}),
    ...(in_(body, "enabled") ? { enabled: body.enabled } : {}),
    ...(in_(body, "recurrence") ? { recurrence: clearableJson(body.recurrence) } : {}),
    ...(in_(body, "scheduledFor") ? { scheduledFor: body.scheduledFor } : {}),
    ...(reQueues ? { lastSentAt: null, sentAt: null } : {}),
  };

  return data;
}

/**
 * Whether the client actually sent this key.
 *
 * `in` rather than `!== undefined`, because `null` is a value the client can
 * legitimately send to clear a field, and `!== undefined` cannot tell that apart
 * from the key being absent. `in` does, which is the whole reason this helper is
 * not a one-liner.
 */
function in_(body: ReminderUpdateInput, key: keyof ReminderUpdateInput): boolean {
  return Object.prototype.hasOwnProperty.call(body, key);
}

/**
 * Translating "the client sent null" into the value Prisma treats as SQL NULL.
 *
 * `recurrence` is a Json column, and for those Prisma refuses a bare `null`:
 * it is ambiguous between "store the JSON value null" and "store SQL NULL", so
 * it will not type-check and silently cannot be written. The two are spelled
 * `Prisma.JsonNull` and `Prisma.DbNull`.
 *
 * Which one is wanted here is not a detail. A "reminder should stop repeating"
 * request has to clear the column outright, so it is `DbNull`. Choosing
 * `JsonNull` instead would store the four-byte JSON literal `null` in the
 * column, which survives every read as something that is not a recurrence but
 * also not absent - and `isDue` would go on treating it as one.
 */
function clearableJson(value: ReminderUpdateInput["recurrence"]) {
  return value === null ? Prisma.DbNull : value;
}

/**
 * The `data` for reminder creation.
 *
 * Nullish fields are written as null rather than left undefined so the row is
 * explicit about having no recurrence, instead of inheriting whatever a future
 * change to the column default would decide.
 */
export function buildReminderCreate(
  body: ReminderCreateInput,
): Omit<Prisma.ReminderUncheckedCreateInput, "userId"> {
  return {
    title: body.title,
    body: body.body ?? null,
    scheduledFor: body.scheduledFor,
    // `?? null` first, so "omitted" and "explicitly none" take the same path:
    // on create there is no previous value to preserve, and both mean the row
    // should say it has no recurrence.
    recurrence: clearableJson(body.recurrence ?? null),
    targetType: body.targetType,
    type: body.targetType,
    targetId: body.targetId ?? null,
    enabled: body.enabled,
  };
}
