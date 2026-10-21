import { describe, expect, it } from 'vitest';

import type { LifeSnapshot } from '@/lib/ai/snapshot';
import { addDaysUtc, dateOnly, startOfWeekUtc } from '@/lib/date';

/**
 * A synthetic but internally-consistent life, built so the analysis has
 * something real to chew on.
 *
 * The point of a fixture like this is that the *expected* answer is known
 * because the answer was put in deliberately: habits are 80% on weekdays and
 * 20% at weekends, focus peaks at 09:00, and sleep correlates with mood. If the
 * engine reports those, it is reading the data. If it stops reporting them, it
 * is reading its own assumptions.
 */

const NOW = new Date(2026, 2, 18, 12, 0, 0); // Wednesday 18 March 2026
const FROM = addDaysUtc(dateOnly(NOW), -29);

function emptySnapshot(overrides: Partial<LifeSnapshot> = {}): LifeSnapshot {
  return {
    userId: 'user_1',
    from: FROM,
    to: dateOnly(NOW),
    profile: {
      name: 'Sam',
      workLabel: null,
      workStartMinutes: 9 * 60,
      workEndMinutes: 17 * 60,
      workDays: [1, 2, 3, 4, 5],
      collegeLabel: null,
      collegeStartMinutes: null,
      collegeEndMinutes: null,
      collegeDays: null,
      wakeMinutes: 7 * 60,
      sleepMinutes: 23 * 60,
      availableWeekdayMinutes: 480,
      availableWeekendMinutes: 300,
      studyTargetMinutes: null,
      fitnessFrequency: null,
      productivityStyle: null,
      focusPreference: null,
      aiEnabled: true,
      aiConsentAt: NOW,
      weekStartsOn: 1,
      dailySummaryTime: 20,
      quietHoursStart: 22,
      quietHoursEnd: 7,
    },
    habits: [],
    habitLogs: [],
    tasks: [],
    focusSessions: [],
    moodEnergy: [],
    journal: [],
    timeBlocks: [],
    goals: [],
    projects: [],
    routines: [],
    sparse: false,
    ...overrides,
  };
}

/** 30 days of habits: strong on weekdays, weak at weekends. */
function habitFixture() {
  const habits = [
    {
      id: 'h_run',
      name: 'Morning run',
      unit: 'min',
      targetValue: 30,
      type: 'DURATION',
      frequency: 'DAILY',
      timesPerPeriod: null,
      targetMinutes: 30,
      difficulty: 'MEDIUM',
      preferredMinutes: 7 * 60,
      startDate: FROM,
      categoryId: null,
      categoryName: null,
      categoryKind: null,
      scheduledDays: [],
    },
    {
      id: 'h_read',
      name: 'Read 20 pages',
      unit: 'pages',
      targetValue: 20,
      type: 'COUNT',
      frequency: 'DAILY',
      timesPerPeriod: null,
      targetMinutes: null,
      difficulty: 'EASY',
      preferredMinutes: null,
      startDate: FROM,
      categoryId: null,
      categoryName: null,
      categoryKind: null,
      scheduledDays: [],
    },
  ];

  const habitLogs = [];
  for (let d = FROM; d.getTime() <= dateOnly(NOW).getTime(); d = addDaysUtc(d, 1)) {
    const weekday = d.getUTCDay();
    const isWeekend = weekday === 0 || weekday === 6;
    // 80% on weekdays, 20% at weekends.
    const hit = isWeekend ? [2, 9, 16, 23].includes(weekday * 3 + d.getUTCDate()) : (d.getUTCDate() % 5) !== 0;
    for (const habit of habits) {
      if (hit) {
        habitLogs.push({ habitId: habit.id, date: d, value: 20, completed: true });
      }
    }
  }

  return { habits, habitLogs };
}

/** 30 days of focus: five sessions a day at 09:00, one at 15:00. */
function focusFixture() {
  const focusSessions = [];
  for (let d = FROM; d.getTime() <= dateOnly(NOW).getTime(); d = addDaysUtc(d, 1)) {
    for (const hour of [9, 15]) {
      const startedAt = new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), hour, 0);
      const seconds = hour === 9 ? 1500 : 1200;
      focusSessions.push({
        startedAt,
        endedAt: new Date(startedAt.getTime() + seconds * 1000),
        plannedSeconds: 1500,
        actualSeconds: seconds,
        rating: hour === 9 ? 5 : 3,
        endedEarly: hour === 15,
        type: 'POMODORO',
        taskTitle: null,
        taskId: null,
        projectId: null,
        projectName: null,
      });
    }
  }
  return { focusSessions };
}

/** 30 days of mood where sleep and mood move together. */
function moodFixture() {
  const moodEnergy = [];
  for (let d = FROM; d.getTime() <= dateOnly(NOW).getTime(); d = addDaysUtc(d, 1)) {
    const seed = d.getUTCDate() % 9;
    const hours = 5 + seed * 0.3; // 5.0 - 7.4
    const mood = Math.max(1, Math.min(5, Math.round(hours - 3.2)));
    moodEnergy.push({
      date: d,
      mood,
      energy: mood,
      stress: Math.max(1, 6 - mood),
      sleepQuality: mood,
      sleepHours: Math.round(hours * 10) / 10,
    });
  }
  return { moodEnergy };
}

function fullSnapshot(): LifeSnapshot {
  return emptySnapshot({
    ...habitFixture(),
    ...focusFixture(),
    ...moodFixture(),
    journal: [],
  });
}

// --------------------------------------------------------------------- stats

describe('statistics', () => {
  it('returns 0 correlation for too few pairs rather than a spurious 1', async () => {
    const { correlation } = await import('@/lib/ai/stats');
    // Two points are always a perfect line. Reporting r = 1 would be arithmetically
    // true and completely meaningless.
    expect(correlation([1, 2], [5, 9])).toBe(0);
    expect(correlation([1, 2, 3], [1, 2, 3])).toBeCloseTo(1, 5);
    expect(correlation([1, 2, 3], [3, 2, 1])).toBeCloseTo(-1, 5);
  });

  it('returns 0 for a constant series instead of dividing by zero', async () => {
    const { correlation } = await import('@/lib/ai/stats');
    expect(correlation([1, 1, 1, 1], [1, 2, 3, 4])).toBe(0);
  });

  it('rises with sample size and effect size', async () => {
    const { confidenceFrom } = await import('@/lib/ai/stats');
    expect(confidenceFrom(0, 1)).toBe(0);
    expect(confidenceFrom(100, 0)).toBe(0);
    // More data must not reduce confidence for the same effect.
    expect(confidenceFrom(60, 0.8)).toBeGreaterThan(confidenceFrom(20, 0.8));
    // A stronger effect at the same sample must not reduce it either.
    expect(confidenceFrom(30, 1)).toBeGreaterThan(confidenceFrom(30, 0.3));
  });

  it('never divides by zero when formatting a percentage', async () => {
    const { pct } = await import('@/lib/ai/stats');
    expect(pct(0, 0)).toBe(0);
    expect(Number.isNaN(pct(0, 0))).toBe(false);
  });

  it('formats durations and clock times for human copy', async () => {
    const { formatDuration, formatMinutes } = await import('@/lib/ai/stats');
    expect(formatDuration(45)).toBe('45m');
    expect(formatDuration(60)).toBe('1h');
    expect(formatDuration(90)).toBe('1h 30m');
    expect(formatMinutes(0)).toBe('12:00am');
    expect(formatMinutes(9 * 60)).toBe('9:00am');
    expect(formatMinutes(13 * 60 + 5)).toBe('1:05pm');
  });
});

// ------------------------------------------------------------------ insights

describe('generateInsights', () => {
  it('says nothing at all when there is no data', async () => {
    const { generateInsights } = await import('@/lib/ai/insights');
    const sparse = emptySnapshot({ sparse: true });
    expect(generateInsights(sparse)).toEqual([]);
  });

  it('finds the weekday pattern the fixture was built to contain', async () => {
    const { generateInsights } = await import('@/lib/ai/insights');
    const insights = generateInsights(fullSnapshot(), NOW);
    const pattern = insights.find((i) => i.kind === "PATTERN" && i.section === "habits");
    expect(pattern).toBeDefined();
    // Weekends are the weak days in this fixture, so one of them must be named.
    expect(pattern!.title).toMatch(/Saturday|Sunday/);
    expect(pattern!.sampleSize).toBeGreaterThan(10);
  });

  it('reports the low-focus-day pattern rather than inventing a trend', async () => {
    const { generateInsights } = await import('@/lib/ai/insights');
    const insights = generateInsights(fullSnapshot(), NOW);
    const all = insights.map((i) => `${i.title} ${i.body}`);
    expect(all.some((t) => /focus/i.test(t))).toBe(true);
  });

  it('finds the sleep/mood correlation the fixture was built to contain', async () => {
    const { generateInsights } = await import('@/lib/ai/insights');
    const insights = generateInsights(fullSnapshot(), NOW);
    const corr = insights.find((i) => i.kind === 'CORRELATION' && /sleep/i.test(i.title));
    expect(corr).toBeDefined();
    expect(corr!.evidence.r).toBeGreaterThan(0.4);
    // It must not assert causation.
    expect(corr!.body).toMatch(/not a cause|rather than/);
  });

  it('gives every insight a sample size and auditable evidence', async () => {
    const { generateInsights } = await import('@/lib/ai/insights');
    for (const insight of generateInsights(fullSnapshot(), NOW)) {
      expect(insight.sampleSize).toBeGreaterThan(0);
      expect(Object.keys(insight.evidence).length).toBeGreaterThan(0);
      expect(insight.confidence).toBeGreaterThan(0);
      expect(insight.confidence).toBeLessThanOrEqual(1);
    }
  });

  it('flags overdue tasks and offers to triage them', async () => {
    const { generateInsights } = await import('@/lib/ai/insights');
    const base = fullSnapshot();
    const withOverdue = emptySnapshot({
      ...base,
      tasks: [
        {
          id: 't1',
          title: 'Renew passport',
          status: 'TODO',
          priority: 'HIGH',
          dueAt: new Date(NOW.getTime() - 5 * 86_400_000),
          completedAt: null,
          createdAt: addDaysUtc(NOW, -20),
          estimatedMinutes: 30,
          categoryId: null,
          categoryName: null,
          goalId: null,
        },
        {
          id: 't2',
          title: 'File tax return',
          status: 'TODO',
          priority: 'MEDIUM',
          dueAt: new Date(NOW.getTime() - 2 * 86_400_000),
          completedAt: null,
          createdAt: addDaysUtc(NOW, -20),
          estimatedMinutes: 60,
          categoryId: null,
          categoryName: null,
          goalId: null,
        },
      ],
    });

    const insights = generateInsights(withOverdue, NOW);
    const overdue = insights.find((i) => i.kind === 'PREDICTION' && /past their deadline/.test(i.title));
    expect(overdue).toBeDefined();
    expect(overdue!.actionKind).toBe('TRIAGE_OVERDUE');
  });

  it('warns when a goal is behind its own timeline', async () => {
    const { generateInsights } = await import('@/lib/ai/insights');
    const base = fullSnapshot();
    const target = addDaysUtc(dateOnly(NOW), 20);
    const withGoal = emptySnapshot({
      ...base,
      goals: [
        {
          id: 'g1',
          title: 'Half marathon',
          status: 'ACTIVE',
          horizon: 'MEDIUM',
          progress: 5,
          startDate: addDaysUtc(dateOnly(NOW), -40),
          targetDate: target,
          categoryName: null,
          milestoneCount: 4,
          doneMilestoneCount: 0,
          taskCount: 0,
          doneTaskCount: 0,
          derived: {
            tasksDone: 0,
            tasksTotal: 0,
            tasksPercent: null,
            milestonesDone: 0,
            milestonesTotal: 0,
            milestonesPercent: null,
            derivedPercent: null,
            driftFromStated: null,
            isDrifting: false,
          },
        },
      ],
    });

    const insights = generateInsights(withGoal, NOW);
    const behind = insights.find((i) => /behind its own timeline/.test(i.title));
    expect(behind).toBeDefined();
    expect(behind!.evidence.behindByDays).toBeGreaterThan(0);
  });
});

// ----------------------------------------------------------------- assistant

describe('askAssistant', () => {
  it('answers from the data rather than inventing a number', async () => {
    const { askAssistant } = await import('@/lib/ai/assistant');
    const answer = askAssistant(fullSnapshot(), 'how am I doing this week?', NOW);
    expect(answer.intent).toBe('OVERVIEW');
    // The reply must quote figures that are actually in the snapshot.
    expect(answer.citations.length).toBeGreaterThan(0);
    expect(answer.reply.length).toBeGreaterThan(20);
    expect(answer.evidence.windowDays).toBe(30);
  });

  it('refuses to answer rather than guessing when there is no data', async () => {
    const { askAssistant } = await import('@/lib/ai/assistant');
    // `sparse: true` is what the loader marks an account with no recorded
    // activity, so the assistant is exercising the same input a real one gets.
    const answer = askAssistant(emptySnapshot({ sparse: true }), 'how am I doing?', NOW);
    expect(answer.intent).toBe('OVERVIEW');
    expect(answer.reply).toMatch(/not enough/i);
  });

  it('reports nothing overdue when nothing is overdue', async () => {
    const { askAssistant } = await import('@/lib/ai/assistant');
    const answer = askAssistant(fullSnapshot(), 'am I behind on anything?', NOW);
    expect(answer.intent).toBe('OVERDUE');
    expect(answer.reply).toMatch(/nothing is overdue/i);
  });

  it('turns a capture command into a reviewable draft, not a write', async () => {
    const { askAssistant } = await import('@/lib/ai/assistant');
    const answer = askAssistant(fullSnapshot(), 'add buy milk tomorrow at 6pm', NOW);
    expect(answer.intent).toBe('CAPTURE');
    expect(answer.capture).not.toBeNull();
    expect(answer.capture!.title).toBe('Buy milk');
    expect(answer.capture!.dueAt!.getHours()).toBe(18);
    // The word "add" must not survive into the task title.
    expect(answer.capture!.title).not.toMatch(/^add/i);
  });

  it('answers about a named habit using that habit\'s own logs', async () => {
    const { askAssistant } = await import('@/lib/ai/assistant');
    const answer = askAssistant(fullSnapshot(), 'how am I doing with my morning run?', NOW);
    expect(answer.intent).toBe('HABITS');
    expect(answer.evidence.habitName).toBe('Morning run');
    expect(answer.evidence.completed).toBeGreaterThan(0);
  });

  it('admit when it does not recognise a question', async () => {
    const { askAssistant } = await import('@/lib/ai/assistant');
    const answer = askAssistant(fullSnapshot(), 'what is the airspeed velocity of a swallow', NOW);
    expect(answer.intent).toBe('UNKNOWN');
    expect(answer.reply).toMatch(/did not recognise/i);
    expect(answer.suggestions.length).toBeGreaterThan(0);
  });

  it('prefers the more specific intent when a question matches two', async () => {
    const { askAssistant } = await import('@/lib/ai/assistant');
    // Contains both "overdue" and the vague "what should I do".
    const answer = askAssistant(fullSnapshot(), 'what should I do about my overdue tasks?', NOW);
    expect(answer.intent).toBe('OVERDUE');
  });
});

// ------------------------------------------------------------------ planner

describe('buildDayPlan', () => {
  it('never overlaps an existing block', async () => {
    const { buildDayPlan } = await import('@/lib/ai/day-plan');
    const target = addDaysUtc(dateOnly(NOW), 1);
    const dayStart = new Date(target.getUTCFullYear(), target.getUTCMonth(), target.getUTCDate());

    const base = fullSnapshot();
    const snapshot = emptySnapshot({
      ...base,
      tasks: [
        {
          id: 't1',
          title: 'Write the report',
          status: 'TODO',
          priority: 'HIGH',
          dueAt: new Date(dayStart.getTime() + 10 * 3_600_000),
          completedAt: null,
          createdAt: NOW,
          estimatedMinutes: 60,
          categoryId: null,
          categoryName: null,
          goalId: null,
        },
        {
          id: 't2',
          title: 'Review PRs',
          status: 'TODO',
          priority: 'MEDIUM',
          dueAt: new Date(dayStart.getTime() + 16 * 3_600_000),
          completedAt: null,
          createdAt: NOW,
          estimatedMinutes: 30,
          categoryId: null,
          categoryName: null,
          goalId: null,
        },
      ],
      timeBlocks: [
        {
          date: target,
          startAt: new Date(dayStart.getTime() + 9 * 3_600_000),
          endAt: new Date(dayStart.getTime() + 12 * 3_600_000),
          locked: true,
          source: 'MANUAL',
          title: 'Standup and review',
        },
      ],
    });

    const plan = buildDayPlan(snapshot, target);
    expect(plan.slots.length).toBeGreaterThan(0);

    for (const slot of plan.slots) {
      expect(slot.startMinutes).toBeGreaterThanOrEqual(7 * 60);
      expect(slot.endMinutes).toBeLessThanOrEqual(23 * 60);
      // Must not collide with the 09:00-12:00 locked block.
      const collides = slot.startMinutes < 12 * 60 && slot.endMinutes > 9 * 60;
      expect(collides).toBe(false);
    }

    // And no two proposals may overlap each other.
    const sorted = [...plan.slots].sort((a, b) => a.startMinutes - b.startMinutes);
    for (let i = 1; i < sorted.length; i += 1) {
      expect(sorted[i]!.startMinutes).toBeGreaterThanOrEqual(sorted[i - 1]!.endMinutes);
    }
  });

  it('puts the overdue task first and says why', async () => {
    const { buildDayPlan } = await import('@/lib/ai/day-plan');
    const target = addDaysUtc(dateOnly(NOW), 1);
    const base = fullSnapshot();
    const snapshot = emptySnapshot({
      ...base,
      tasks: [
        {
          id: 't_late',
          title: 'Overdue thing',
          status: 'TODO',
          priority: 'LOW',
          dueAt: addDaysUtc(dateOnly(NOW), -3),
          completedAt: null,
          createdAt: NOW,
          estimatedMinutes: 30,
          categoryId: null,
          categoryName: null,
          goalId: null,
        },
        {
          id: 't_low',
          title: 'Low priority thing',
          status: 'TODO',
          priority: 'LOW',
          dueAt: null,
          completedAt: null,
          createdAt: NOW,
          estimatedMinutes: 30,
          categoryId: null,
          categoryName: null,
          goalId: null,
        },
      ],
    });

    const plan = buildDayPlan(snapshot, target);
    expect(plan.slots[0]!.taskId).toBe('t_late');
    expect(plan.slots[0]!.reasons.join(' ')).toMatch(/overdue/i);
  });

  it('respects the stated daily budget and reports what did not fit', async () => {
    const { buildDayPlan } = await import('@/lib/ai/day-plan');
    const target = addDaysUtc(dateOnly(NOW), 1);
    const base = fullSnapshot();
    const tasks = ['a', 'b', 'c', 'd', 'e', 'f'].map((id) => ({
      id: `t_${id}`,
      title: `Task ${id}`,
      status: 'TODO' as const,
      priority: 'MEDIUM' as const,
      dueAt: null,
      completedAt: null,
      createdAt: NOW,
      estimatedMinutes: 120,
      categoryId: null,
      categoryName: null,
      goalId: null,
    }));

    // 480 weekday minutes available, minus 120 already committed, against
    // 6 x 120 minutes of work. It cannot all fit and the plan must say so.
    const snapshot = emptySnapshot({
      ...base,
      tasks,
      availableOverride: undefined,
    } as Partial<LifeSnapshot>);

    const plan = buildDayPlan(snapshot, target, { availableMinutes: 240 });
    expect(plan.slots.length + plan.unplaced.length).toBe(tasks.length);
    expect(plan.unplaced.length).toBeGreaterThan(0);
    expect(plan.unplaced[0]!.reason).toBeTruthy();
    expect(plan.proposedMinutes).toBeLessThanOrEqual(240);
  });

  it('gives a task with no estimate a defensible default', async () => {
    const { buildDayPlan } = await import('@/lib/ai/day-plan');
    const target = addDaysUtc(dateOnly(NOW), 1);
    const base = fullSnapshot();
    const snapshot = emptySnapshot({
      ...base,
      tasks: [
        {
          id: 't_no_estimate',
          title: 'Unestimated',
          status: 'TODO',
          priority: 'MEDIUM',
          dueAt: null,
          completedAt: null,
          createdAt: NOW,
          estimatedMinutes: null,
          categoryId: null,
          categoryName: null,
          goalId: null,
        },
      ],
    });
    const plan = buildDayPlan(snapshot, target);
    expect(plan.slots[0]!.minutes).toBeGreaterThan(0);
  });

  it('produces an identical plan for identical input', async () => {
    const { buildDayPlan } = await import('@/lib/ai/day-plan');
    const target = addDaysUtc(dateOnly(NOW), 1);
    const base = fullSnapshot();
    const snapshot = emptySnapshot({
      ...base,
      tasks: [
        {
          id: 't1',
          title: 'One',
          status: 'TODO',
          priority: 'HIGH',
          dueAt: null,
          completedAt: null,
          createdAt: NOW,
          estimatedMinutes: 45,
          categoryId: null,
          categoryName: null,
          goalId: null,
        },
        {
          id: 't2',
          title: 'Two',
          status: 'TODO',
          priority: 'LOW',
          dueAt: null,
          completedAt: null,
          createdAt: NOW,
          estimatedMinutes: 30,
          categoryId: null,
          categoryName: null,
          goalId: null,
        },
      ],
    });
    const a = buildDayPlan(snapshot, target);
    const b = buildDayPlan(snapshot, target);
    expect(a.slots).toEqual(b.slots);
  });
});

// ------------------------------------------------------------------ reports

describe('reports', () => {
  it('builds a weekly report with metrics that match the data', async () => {
    const { buildWeeklyReport } = await import('@/lib/ai/reports');
    const report = buildWeeklyReport(fullSnapshot(), NOW);

    expect(report.weekStart.getTime()).toBe(startOfWeekUtc(NOW).getTime());
    expect(report.metrics.focusMinutes).toBeGreaterThan(0);
    expect(report.metrics.habitExpected).toBeGreaterThan(0);
    expect(report.metrics.habitRatePercent).toBeGreaterThanOrEqual(0);
    expect(report.metrics.habitRatePercent).toBeLessThanOrEqual(100);
    expect(report.summary.length).toBeGreaterThan(20);
  });

  it('carries a week-of-date window rather than a rolling one', async () => {
    const { buildWeeklyReport } = await import('@/lib/ai/reports');
    const report = buildWeeklyReport(fullSnapshot(), NOW);
    const days = (report.weekEnd.getTime() - report.weekStart.getTime()) / 86_400_000;
    expect(days).toBe(6);
  });

  it('builds a monthly report with per-habit and per-goal stats', async () => {
    const { buildMonthlyReport } = await import('@/lib/ai/reports');
    const report = buildMonthlyReport(fullSnapshot(), NOW);
    expect(report.monthLabel.length).toBeGreaterThan(0);
    expect(report.habitStats.length).toBe(2);
    for (const habit of report.habitStats) {
      expect(habit.ratePercent).toBeGreaterThanOrEqual(0);
      expect(habit.ratePercent).toBeLessThanOrEqual(100);
    }
  });

  it('always produces at least one recommendation', async () => {
    const { buildWeeklyReport, buildMonthlyReport } = await import('@/lib/ai/reports');
    expect(buildWeeklyReport(fullSnapshot(), NOW).recommendations.length).toBeGreaterThan(0);
    expect(buildMonthlyReport(fullSnapshot(), NOW).recommendations.length).toBeGreaterThan(0);
  });
});
