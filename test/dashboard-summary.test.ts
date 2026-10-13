import { describe, expect, it } from 'vitest';

import {
  MIN_CORRELATION,
  MIN_PAIR_SAMPLES,
  correlationPanel,
  goalPanel,
  projectPanel,
  trackSummary,
} from '@/lib/dashboard-summary';
import type { LifeSnapshot } from '@/lib/ai/snapshot';

const NOW = new Date('2026-09-28T12:00:00.000Z');
const DAY = 86_400_000;

function daysAgo(n: number, hours = 12): Date {
  return new Date(NOW.getTime() - n * DAY + hours * 3_600_000 - 12 * 3_600_000);
}

function snapshot(overrides: Partial<LifeSnapshot> = {}): LifeSnapshot {
  return {
    userId: 'user_1',
    from: new Date(NOW.getTime() - 6 * DAY),
    to: NOW,
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
    knowledge: {
      notes: [],
      resources: [],
      noteCount: 0,
      resourceCount: 0,
      recentNoteCount: 0,
      recentResourceCount: 0,
    },
    sparse: false,
    ...overrides,
  };
}

function projectFixture(overrides: Record<string, unknown> = {}) {
  return {
    id: 'p_launch',
    name: 'Launch',
    status: 'ACTIVE',
    dueAt: null,
    taskCount: 2,
    doneTaskCount: 2,
    milestoneCount: 0,
    doneMilestoneCount: 0,
    goalId: 'g_ship',
    goalTitle: 'Ship it',
    focusSeconds: 3600,
    tasks: [
      { status: 'DONE', completedAt: daysAgo(1) },
      { status: 'DONE', completedAt: daysAgo(2) },
    ],
    ...overrides,
  } as LifeSnapshot['projects'][number];
}

describe('goalPanel', () => {
  it('states each goal twice and flags the gap', () => {
    const panel = goalPanel(
      snapshot({
        goals: [
          {
            id: 'g_ship',
            title: 'Ship it',
            status: 'ACTIVE',
            horizon: 'QUARTER',
            progress: 90,
            startDate: null,
            targetDate: null,
            categoryName: null,
            milestoneCount: 0,
            doneMilestoneCount: 0,
            taskCount: 10,
            doneTaskCount: 1,
            derived: {
              tasksDone: 1,
              tasksTotal: 10,
              tasksPercent: 10,
              milestonesDone: 0,
              milestonesTotal: 0,
              milestonesPercent: null,
              derivedPercent: 10,
              driftFromStated: 80,
              isDrifting: true,
            },
          },
        ],
      }),
    );

    expect(panel.entries[0]!.stated).toBe(90);
    expect(panel.entries[0]!.derived).toBe(10);
    expect(panel.entries[0]!.isDrifting).toBe(true);
    expect(panel.driftingCount).toBe(1);
  });

  it('averages the derived figure over measured goals only', () => {
    const base = {
      status: 'ACTIVE',
      horizon: 'YEAR',
      startDate: null,
      targetDate: null,
      categoryName: null,
      milestoneCount: 0,
      doneMilestoneCount: 0,
      taskCount: 0,
      doneTaskCount: 0,
    };

    const panel = goalPanel(
      snapshot({
        goals: [
          {
            ...base,
            id: 'g_measured',
            title: 'Measured',
            progress: 50,
            derived: {
              tasksDone: 1,
              tasksTotal: 2,
              tasksPercent: 50,
              milestonesDone: 0,
              milestonesTotal: 0,
              milestonesPercent: null,
              derivedPercent: 50,
              driftFromStated: 0,
              isDrifting: false,
            },
          },
          {
            ...base,
            id: 'g_empty',
            title: 'Nothing attached',
            progress: 0,
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
      }),
    );

    // 50, not 25. An unmeasured goal is not a 0% goal.
    expect(panel.derivedAverage).toBe(50);
    expect(panel.activeCount).toBe(2);
  });

  it('ignores goals that are not active', () => {
    const panel = goalPanel(
      snapshot({
        goals: [
          {
            id: 'g_done',
            title: 'Archived',
            status: 'COMPLETED',
            horizon: 'YEAR',
            progress: 100,
            startDate: null,
            targetDate: null,
            categoryName: null,
            milestoneCount: 0,
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
      }),
    );

    expect(panel.entries).toHaveLength(0);
    expect(panel.derivedAverage).toBeNull();
  });
});

describe('projectPanel', () => {
  it('gives each project only its own completed tasks', () => {
    const panel = projectPanel(
      snapshot({
        projects: [projectFixture()],
        // A task closed in the window that belongs to no project at all. If
        // momentum is fed the whole task list this project reports 3, crediting
        // itself with someone else's work.
        tasks: [
          { id: 't_1', title: 'A', status: 'DONE', priority: 'MEDIUM', dueAt: null, completedAt: daysAgo(1), createdAt: daysAgo(9), estimatedMinutes: null, categoryId: null, categoryName: null, goalId: null },
          { id: 't_2', title: 'B', status: 'DONE', priority: 'MEDIUM', dueAt: null, completedAt: daysAgo(1), createdAt: daysAgo(9), estimatedMinutes: null, categoryId: null, categoryName: null, goalId: null },
          { id: 't_3', title: 'Unrelated', status: 'DONE', priority: 'MEDIUM', dueAt: null, completedAt: daysAgo(1), createdAt: daysAgo(9), estimatedMinutes: null, categoryId: null, categoryName: null, goalId: null },
        ],
      }),
    );

    expect(panel.entries[0]!.momentum.completedRecent).toBe(2);
  });

  it('reports unattributed focus in seconds, not a negative clamped zero', () => {
    const panel = projectPanel(
      snapshot({
        projects: [projectFixture()],
        focusSessions: [
          {
            startedAt: daysAgo(1),
            endedAt: daysAgo(1),
            plannedSeconds: 3600,
            actualSeconds: 3600,
            rating: 4,
            endedEarly: false,
            type: 'DEEP',
            taskTitle: 'A',
            taskId: 't_1',
            projectId: 'p_launch',
            projectName: 'Launch',
          },
          {
            startedAt: daysAgo(2),
            endedAt: daysAgo(2),
            plannedSeconds: 1800,
            actualSeconds: 1800,
            rating: null,
            endedEarly: false,
            type: 'SHALLOW',
            taskTitle: null,
            taskId: null,
            projectId: null,
            projectName: null,
          },
          {
            // Abandoned timer: no recorded time, so it is not focus at all.
            startedAt: daysAgo(1),
            endedAt: null,
            plannedSeconds: 900,
            actualSeconds: 0,
            rating: null,
            endedEarly: true,
            type: 'DEEP',
            taskTitle: null,
            taskId: null,
            projectId: null,
            projectName: null,
          },
        ],
      }),
    );

    expect(panel.attributedFocusSeconds).toBe(3600);
    // 5400 in the window, 3600 attributed. The old code subtracted seconds from
    // a count of sessions (2 - 3600) and clamped to 0, reporting that 100% of
    // focus was attributed when a third of it plainly was not.
    expect(panel.unattributedFocusSeconds).toBe(1800);
  });

  it('reports zero percent for a project with no tasks rather than dividing by zero', () => {
    const panel = projectPanel(
      snapshot({ projects: [projectFixture({ taskCount: 0, doneTaskCount: 0, tasks: [] })] }),
    );

    expect(panel.entries[0]!.percent).toBe(0);
    expect(Number.isNaN(panel.entries[0]!.percent)).toBe(false);
  });
});

describe('trackSummary', () => {
  it('returns null completion when the track has no logs', () => {
    const summary = trackSummary(
      snapshot({
        habits: [
          { id: 'h_run', name: 'Morning run', unit: 'min', categoryId: 'c_fit', categoryKind: 'FITNESS' } as never,
        ],
        habitLogs: [],
      }),
      'FITNESS',
    );

    expect(summary.habitCount).toBe(1);
    expect(summary.completion).toBeNull();
    expect(summary.empty).toBe(false);
  });

  it('marks a track with no habits as empty', () => {
    expect(trackSummary(snapshot(), 'FITNESS').empty).toBe(true);
    expect(trackSummary(snapshot(), 'STUDY').completion).toBeNull();
  });
});

describe('correlationPanel', () => {
  it('reports nothing at all when there is too little data', () => {
    const entries = correlationPanel(
      snapshot({
        moodEnergy: [
          { date: new Date(NOW.getTime() - 2 * DAY), mood: 4, energy: 3, stress: 2, sleepQuality: 3, sleepHours: 7, note: null } as never,
        ],
        focusSessions: [
          { startedAt: daysAgo(1), endedAt: daysAgo(1), plannedSeconds: 1800, actualSeconds: 1800, rating: null, endedEarly: false, type: 'DEEP', taskTitle: null, taskId: null, projectId: null, projectName: null },
        ],
      }),
    );

    // A correlation over two days is computable and useless. Silence is the
    // honest answer; "no relationship" would be a claim the data cannot support.
    expect(entries).toHaveLength(0);
  });

  it('exposes the floors it enforces so callers can explain them', () => {
    expect(MIN_PAIR_SAMPLES).toBeGreaterThan(0);
    expect(MIN_CORRELATION).toBeGreaterThan(0);
  });
});
