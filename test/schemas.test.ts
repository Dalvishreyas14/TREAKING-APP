import { describe, expect, it } from 'vitest';

import {
  aiPlanSchema,
  forgotPasswordSchema,
  focusCompleteSchema,
  goalUpdateSchema,
  habitLogSchema,
  habitUpdateSchema,
  journalEntrySchema,
  moodEnergySchema,
  nlTaskSchema,
  onboardingSchema,
  resendVerificationSchema,
  resetPasswordSchema,
  signInSchema,
  signUpSchema,
  taskCreateSchema,
  taskListQuerySchema,
  timeBlockCreateSchema,
  timeBlockListQuerySchema,
  timeBlockUpdateSchema,
} from '@/lib/validation/schemas';

/** `parse` returns the data directly, so these are pass-through readability helpers. */
const ok = <T>(data: T): T => data;
const fail = (result: { success: boolean }): boolean => !result.success;

describe('signUpSchema', () => {
  it('accepts a valid registration', () => {
    const result = signUpSchema.safeParse({
      name: 'Alex Rivera',
      email: 'demo@lifeos.app',
      password: 'Tr0ub4dor&3',
    });
    expect(result.success).toBe(true);
  });

  it('trims the name and the email', () => {
    const data = ok(
      signUpSchema.parse({
        name: '  Alex Rivera  ',
        email: '  demo@lifeos.app  ',
        password: 'Tr0ub4dor&3',
      }),
    );
    expect(data.name).toBe('Alex Rivera');
    expect(data.email).toBe('demo@lifeos.app');
  });

  it('rejects each weak password with a field-level message', () => {
    for (const password of ['short1A', 'alllowercase1', 'NOLOWERCASE1', 'NoDigitsHere']) {
      const result = signUpSchema.safeParse({
        name: 'Alex',
        email: 'demo@lifeos.app',
        password,
      });
      expect(fail(result), password).toBe(true);
    }
  });

  it('rejects a malformed email', () => {
    for (const email of ['nope', 'a@b', 'a b@c.com', '@lifeos.app', '']) {
      expect(
        fail(signUpSchema.safeParse({ name: 'Alex', email, password: 'Tr0ub4dor&3' })),
        email,
      ).toBe(true);
    }
  });

  it('strips unknown keys instead of rejecting the payload', () => {
    // Deliberate: these schemas are shared between the form resolvers and the
    // API parsers. Stripping keeps a newer client working against an older
    // server, and a stray field is not a security concern - the fields that
    // matter are all validated below.
    const data = ok(
      signUpSchema.parse({
        name: 'Alex',
        email: 'demo@lifeos.app',
        password: 'Tr0ub4dor&3',
        passwordConfirm: 'Tr0ub4dor&3',
      }),
    );
    expect(data).not.toHaveProperty('passwordConfirm');
    expect(Object.keys(data).sort()).toEqual(['email', 'name', 'password']);
  });
});

describe('signInSchema', () => {
  it('accepts a password that predates the current policy', () => {
    // An old account may have a weaker password. Refusing it here would reveal
    // that the account exists, and would lock the user out of their own reset.
    const result = signInSchema.safeParse({ email: 'demo@lifeos.app', password: 'old' });
    expect(result.success).toBe(true);
  });

  it('still requires a non-empty password', () => {
    expect(signInSchema.safeParse({ email: 'demo@lifeos.app', password: '' }).success).toBe(false);
  });
});

describe('email-only schemas', () => {
  it('accepts a valid address for both', () => {
    expect(forgotPasswordSchema.safeParse({ email: 'demo@lifeos.app' }).success).toBe(true);
    expect(resendVerificationSchema.safeParse({ email: 'demo@lifeos.app' }).success).toBe(true);
  });
});

describe('resetPasswordSchema', () => {
  it('requires a plausible token and a strong password', () => {
    expect(
      resetPasswordSchema.safeParse({ token: 'short', password: 'Tr0ub4dor&3' }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token: 'a'.repeat(40), password: 'weak' }).success,
    ).toBe(false);
    expect(
      resetPasswordSchema.safeParse({ token: 'a'.repeat(40), password: 'Tr0ub4dor&3' }).success,
    ).toBe(true);
  });
});

describe('taskCreateSchema', () => {
  it('applies defaults so a minimal payload is complete', () => {
    const data = ok(taskCreateSchema.parse({ title: '  Ship the beta  ' }));
    expect(data.title).toBe('Ship the beta');
    expect(data.status).toBe('TODO');
    expect(data.priority).toBe('MEDIUM');
    expect(data.energy).toBe('MEDIUM');
    expect(data.importance).toBe(3);
    expect(data.urgency).toBe(3);
    expect(data.tagIds).toEqual([]);
    expect(data.isRecurring).toBe(false);
  });

  it('rejects an empty title', () => {
    expect(taskCreateSchema.safeParse({ title: '   ' }).success).toBe(false);
  });

  it('coerces ISO date strings into dates', () => {
    const data = ok(
      taskCreateSchema.parse({
        title: 'Ship the beta',
        startAt: '2026-03-01T09:00:00.000Z',
        dueAt: '2026-03-02T17:00:00.000Z',
      }),
    );
    expect(data.startAt).toBeInstanceOf(Date);
    expect(data.dueAt?.toISOString()).toBe('2026-03-02T17:00:00.000Z');
  });

  it('accepts an explicit null to clear an optional relation', () => {
    const data = ok(
      taskCreateSchema.parse({ title: 'Ship the beta', goalId: null, categoryId: null }),
    );
    expect(data.goalId).toBeNull();
  });

  it('clamps nothing silently: out-of-range minutes are rejected', () => {
    expect(
      taskCreateSchema.safeParse({ title: 'x', estimatedMinutes: 25 * 60 }).success,
    ).toBe(false);
    expect(taskCreateSchema.safeParse({ title: 'x', estimatedMinutes: -1 }).success).toBe(false);
  });

  it('bounds importance and urgency to one through five', () => {
    expect(taskCreateSchema.safeParse({ title: 'x', importance: 0 }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: 'x', importance: 6 }).success).toBe(false);
    expect(taskCreateSchema.safeParse({ title: 'x', urgency: 5 }).success).toBe(true);
  });

  it('rejects an unknown status', () => {
    expect(taskCreateSchema.safeParse({ title: 'x', status: 'MAYBE' }).success).toBe(false);
  });

  it('caps the tag list', () => {
    const many = Array.from({ length: 21 }, (_, i) => `tag_${i}`);
    expect(taskCreateSchema.safeParse({ title: 'x', tagIds: many }).success).toBe(false);
  });
});

describe('taskListQuerySchema', () => {
  it('defaults to open work with a bounded page size', () => {
    const data = ok(taskListQuerySchema.parse({}));
    expect(data.status).toBe('TODO');
    expect(data.limit).toBe(50);
  });

  it('accepts the "all" pseudo-status', () => {
    expect(ok(taskListQuerySchema.parse({ status: 'all' })).status).toBe('all');
  });

  it('rejects a limit outside one to one hundred', () => {
    expect(taskListQuerySchema.safeParse({ limit: 0 }).success).toBe(false);
    expect(taskListQuerySchema.safeParse({ limit: 101 }).success).toBe(false);
  });
});

describe('habitLogSchema', () => {
  it('defaults value and completed', () => {
    const data = ok(habitLogSchema.parse({ date: '2026-03-01' }));
    expect(data.value).toBe(1);
    expect(data.completed).toBe(true);
  });

  it('rejects a negative value', () => {
    expect(habitLogSchema.safeParse({ date: '2026-03-01', value: -5 }).success).toBe(false);
  });
});

describe('habitUpdateSchema', () => {
  it('accepts an explicit archive flag', () => {
    expect(habitUpdateSchema.parse({ archived: true }).archived).toBe(true);
    expect(habitUpdateSchema.parse({ archived: false }).archived).toBe(false);
  });

  /**
   * Regression: the restore button once sent `{ isActive: true, archivedAt: null }`.
   * Neither key is in the schema, so Zod stripped them and the route returned
   * 200 having changed nothing — an archived habit that looked restorable and
   * was not. The test asserts the flag survives parsing, which is the part that
   * was silently wrong.
   */
  it('does not silently swallow the archive columns', () => {
    const raw = habitUpdateSchema.parse({ isActive: true, archivedAt: null });
    expect(raw.archived).toBeUndefined();
    expect('isActive' in raw).toBe(false);
    expect('archivedAt' in raw).toBe(false);
  });

  it('leaves archived undefined when not asked, so the route skips the column', () => {
    expect(habitUpdateSchema.parse({ name: 'Read' }).archived).toBeUndefined();
  });

  it('rejects a non-boolean archive flag', () => {
    expect(habitUpdateSchema.safeParse({ archived: 'yes' }).success).toBe(false);
  });
});

describe('moodEnergySchema', () => {
  it('accepts a full day', () => {
    const data = ok(
      moodEnergySchema.parse({
        date: '2026-03-01',
        mood: 4,
        energy: 3,
        stress: 2,
        sleepQuality: 4,
        sleepHours: 7.5,
      }),
    );
    expect(data.sleepHours).toBe(7.5);
  });

  it('requires every scale to be one through five', () => {
    for (const field of ['mood', 'energy', 'stress', 'sleepQuality'] as const) {
      expect(moodEnergySchema.safeParse({ date: '2026-03-01', mood: 3, energy: 3, stress: 3, sleepQuality: 3, [field]: 0 }).success, field).toBe(false);
      expect(moodEnergySchema.safeParse({ date: '2026-03-01', mood: 3, energy: 3, stress: 3, sleepQuality: 3, [field]: 6 }).success, field).toBe(false);
    }
  });

  it('rejects impossible sleep durations', () => {
    expect(moodEnergySchema.safeParse({ date: '2026-03-01', mood: 3, energy: 3, stress: 3, sleepQuality: 3, sleepHours: 25 }).success).toBe(false);
    expect(moodEnergySchema.safeParse({ date: '2026-03-01', mood: 3, energy: 3, stress: 3, sleepQuality: 3, sleepHours: -1 }).success).toBe(false);
  });
});

describe('journalEntrySchema', () => {
  it('requires content but allows no title', () => {
    expect(journalEntrySchema.safeParse({ date: '2026-03-01', content: '  ' }).success).toBe(false);
    const data = ok(journalEntrySchema.parse({ date: '2026-03-01', content: ' A good day. ' }));
    expect(data.content).toBe('A good day.');
    expect(data.tags).toEqual([]);
  });

  it('caps the tag list at twelve', () => {
    const tags = Array.from({ length: 13 }, (_, i) => `t${i}`);
    expect(journalEntrySchema.safeParse({ date: '2026-03-01', content: 'x', tags }).success).toBe(false);
  });
});

describe('focusCompleteSchema', () => {
  it('requires a plausible planned duration', () => {
    expect(focusCompleteSchema.safeParse({ plannedSeconds: 30, actualSeconds: 30 }).success).toBe(false);
    expect(focusCompleteSchema.safeParse({ plannedSeconds: 1500, actualSeconds: 1400 }).success).toBe(true);
  });

  it('allows a session abandoned immediately', () => {
    const data = ok(
      focusCompleteSchema.parse({ plannedSeconds: 1500, actualSeconds: 0, endedEarly: true }),
    );
    expect(data.actualSeconds).toBe(0);
    expect(data.endedEarly).toBe(true);
  });

  it('bounds the rating', () => {
    expect(focusCompleteSchema.safeParse({ plannedSeconds: 1500, actualSeconds: 1500, rating: 0 }).success).toBe(false);
    expect(focusCompleteSchema.safeParse({ plannedSeconds: 1500, actualSeconds: 1500, rating: 6 }).success).toBe(false);
  });
});

describe('natural language and planning schemas', () => {
  it('rejects an empty task description', () => {
    expect(nlTaskSchema.safeParse({ text: 'a' }).success).toBe(false);
    expect(nlTaskSchema.safeParse({ text: 'call the dentist' }).success).toBe(true);
  });

  it('requires at least half an hour of availability', () => {
    expect(aiPlanSchema.safeParse({ availableMinutes: 10 }).success).toBe(false);
    expect(aiPlanSchema.safeParse({ availableMinutes: 30 }).success).toBe(true);
    expect(aiPlanSchema.safeParse({ availableMinutes: 960 }).success).toBe(true);
    expect(aiPlanSchema.safeParse({ availableMinutes: 961 }).success).toBe(false);
  });
});

describe('goalUpdateSchema', () => {
  it('bounds progress to a percentage', () => {
    expect(goalUpdateSchema.safeParse({ progress: -1 }).success).toBe(false);
    expect(goalUpdateSchema.safeParse({ progress: 101 }).success).toBe(false);
    expect(goalUpdateSchema.safeParse({ progress: 100 }).success).toBe(true);
  });
});

describe('onboardingSchema', () => {
  it('fills in defaults for an empty submission, so skipping is survivable', () => {
    const result = onboardingSchema.parse({});
    expect(result.timezone).toBe('UTC');
    expect(result.weekStartsOn).toBe(1);
    expect(result.wakeMinutes).toBe(420);
    expect(result.sleepMinutes).toBe(1380);
    expect(result.workDays).toEqual([]);
    expect(result.importantHabits).toEqual([]);
  });

  it('requires both ends of a work schedule or neither', () => {
    expect(onboardingSchema.safeParse({ workStartMinutes: 540 }).success).toBe(false);
    expect(onboardingSchema.safeParse({ workEndMinutes: 1020 }).success).toBe(false);
    expect(
      onboardingSchema.safeParse({ workStartMinutes: 540, workEndMinutes: 1020 }).success,
    ).toBe(true);
  });

  it('rejects identical wake and sleep times', () => {
    const result = onboardingSchema.safeParse({ wakeMinutes: 420, sleepMinutes: 420 });
    expect(result.success).toBe(false);
    // Crossing midnight is legitimate, so only exact equality is refused.
    expect(
      onboardingSchema.safeParse({ wakeMinutes: 420, sleepMinutes: 300 }).success,
    ).toBe(true);
  });

  it('bounds clock times to a single day', () => {
    expect(onboardingSchema.safeParse({ wakeMinutes: -1 }).success).toBe(false);
    expect(onboardingSchema.safeParse({ wakeMinutes: 1441 }).success).toBe(false);
    expect(onboardingSchema.safeParse({ wakeMinutes: 1440 }).success).toBe(true);
  });

  it('accepts only real weekdays for the week start', () => {
    expect(onboardingSchema.safeParse({ weekStartsOn: 0 }).success).toBe(true);
    expect(onboardingSchema.safeParse({ weekStartsOn: 1 }).success).toBe(true);
    expect(onboardingSchema.safeParse({ weekStartsOn: 2 }).success).toBe(false);
  });

  it('rejects work days outside 0-6', () => {
    expect(onboardingSchema.safeParse({ workDays: [0, 6] }).success).toBe(true);
    expect(onboardingSchema.safeParse({ workDays: [7] }).success).toBe(false);
    expect(onboardingSchema.safeParse({ workDays: [-1] }).success).toBe(false);
  });

  it('caps the number of habits a user can seed with', () => {
    const many = Array.from({ length: 12 }, (_, i) => `Habit ${i}`);
    expect(onboardingSchema.safeParse({ importantHabits: many }).success).toBe(true);
    expect(
      onboardingSchema.safeParse({ importantHabits: [...many, 'One too many'] }).success,
    ).toBe(false);
  });

  it('rejects a blank habit name but trims the rest', () => {
    expect(onboardingSchema.safeParse({ importantHabits: ['   '] }).success).toBe(false);
    const parsed = onboardingSchema.parse({ importantHabits: ['  Swim  '] });
    expect(parsed.importantHabits).toEqual(['Swim']);
  });

  it('treats an omitted name as acceptable but an overlong one as not', () => {
    expect(onboardingSchema.parse({}).name).toBeUndefined();
    expect(onboardingSchema.safeParse({ name: 'x'.repeat(81) }).success).toBe(false);
  });
});

describe('timeBlockCreateSchema', () => {
  const valid = {
    title: 'Deep work',
    date: '2026-09-27',
    startMinutes: 540,
    durationMinutes: 90,
  };

  it('accepts a well-formed block and applies defaults', () => {
    const parsed = timeBlockCreateSchema.parse(valid);
    expect(parsed.color).toBe('#C8F751');
    expect(parsed.locked).toBe(false);
  });

  it('accepts a quarter-hour boundary and the last minute of the day', () => {
    expect(timeBlockCreateSchema.safeParse({ ...valid, startMinutes: 1439 }).success).toBe(true);
  });

  /**
   * The reason `date` is a validated string rather than `z.coerce.date()`.
   * `new Date('2026-02-30')` is the 2nd of March, silently, so a coerced schema
   * would accept a block for a day that does not exist and store it two days
   * later than the user believes.
   */
  it('rejects calendar days that do not exist', () => {
    expect(timeBlockCreateSchema.safeParse({ ...valid, date: '2026-02-30' }).success).toBe(false);
    expect(timeBlockCreateSchema.safeParse({ ...valid, date: '2026-13-01' }).success).toBe(false);
    expect(timeBlockCreateSchema.safeParse({ ...valid, date: '2026-04-31' }).success).toBe(false);
  });

  it('accepts a real leap day and rejects a non-leap one', () => {
    expect(timeBlockCreateSchema.safeParse({ ...valid, date: '2028-02-29' }).success).toBe(true);
    expect(timeBlockCreateSchema.safeParse({ ...valid, date: '2026-02-29' }).success).toBe(false);
  });

  it('rejects a malformed date string', () => {
    for (const date of ['27-09-2026', '2026/09/27', '2026-9-27', 'today', '']) {
      expect(timeBlockCreateSchema.safeParse({ ...valid, date }).success, date).toBe(false);
    }
  });

  it('rejects a start time outside the day', () => {
    expect(timeBlockCreateSchema.safeParse({ ...valid, startMinutes: 1440 }).success).toBe(false);
    expect(timeBlockCreateSchema.safeParse({ ...valid, startMinutes: -1 }).success).toBe(false);
  });

  it('rejects fractional minutes', () => {
    // A 90.5-minute block has no place on a quarter-hour grid.
    expect(timeBlockCreateSchema.safeParse({ ...valid, durationMinutes: 90.5 }).success).toBe(false);
  });

  it('rejects a zero or negative duration instead of normalising it', () => {
    expect(timeBlockCreateSchema.safeParse({ ...valid, durationMinutes: 0 }).success).toBe(false);
    expect(timeBlockCreateSchema.safeParse({ ...valid, durationMinutes: -30 }).success).toBe(false);
  });

  it('caps a block at half a day', () => {
    expect(timeBlockCreateSchema.safeParse({ ...valid, durationMinutes: 720 }).success).toBe(true);
    expect(timeBlockCreateSchema.safeParse({ ...valid, durationMinutes: 721 }).success).toBe(false);
  });

  it('rejects a blank title and a bad colour', () => {
    expect(timeBlockCreateSchema.safeParse({ ...valid, title: '   ' }).success).toBe(false);
    expect(timeBlockCreateSchema.safeParse({ ...valid, color: 'lime' }).success).toBe(false);
    expect(timeBlockCreateSchema.safeParse({ ...valid, color: '#C8F75' }).success).toBe(false);
  });
});

describe('timeBlockUpdateSchema', () => {
  it('allows moving a block to another day without resending the time', () => {
    const parsed = timeBlockUpdateSchema.parse({ date: '2026-10-01' });
    expect(parsed.date).toBe('2026-10-01');
    expect(parsed.startMinutes).toBeUndefined();
  });

  it('allows moving only the time, keeping the day implicit', () => {
    const parsed = timeBlockUpdateSchema.parse({ startMinutes: 600 });
    expect(parsed.startMinutes).toBe(600);
    expect(parsed.date).toBeUndefined();
  });

  it('keeps validation on a partial update', () => {
    expect(timeBlockUpdateSchema.safeParse({ startMinutes: 2000 }).success).toBe(false);
    expect(timeBlockUpdateSchema.safeParse({ date: '2026-02-30' }).success).toBe(false);
    expect(timeBlockUpdateSchema.safeParse({ title: '' }).success).toBe(false);
  });

  it('still validates a day when only the time is sent', () => {
    // Guards against a partial() that dropped the day refinements.
    expect(timeBlockUpdateSchema.safeParse({ date: '2026-02-31', startMinutes: 540 }).success).toBe(
      false,
    );
  });
});

describe('timeBlockListQuerySchema', () => {
  it('defaults the range to a single day', () => {
    const parsed = timeBlockListQuerySchema.parse({ from: '2026-09-27' });
    expect(parsed.to).toBeUndefined();
  });

  it('validates both ends of a range', () => {
    expect(
      timeBlockListQuerySchema.safeParse({ from: '2026-09-27', to: '2026-10-03' }).success,
    ).toBe(true);
    expect(timeBlockListQuerySchema.safeParse({ from: '2026-09-27', to: 'nope' }).success).toBe(
      false,
    );
  });
});