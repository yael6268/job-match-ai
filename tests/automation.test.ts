import { describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { saveMatch, upsertJobsFromSource } from '@/db/repo';
import {
  markJobsViewed, onAlarm, onBrowserStart, onSettingsChanged, refreshBadge, runHooks, scheduleDailyAlarm,
} from '@/pipeline/automation';
import { startOrResumeRun, waitForRun } from '@/pipeline/controller';
import { createRun, type RunDeps } from '@/pipeline/run';
import {
  countNotifiable, DAILY_ALARM, needsCatchUp, nextRunTime, notificationText, unviewedMatchCount, WATCHDOG_ALARM,
} from '@/pipeline/schedule';
import { saveSettings } from '@/shared/storage';
import type { Company, Match, RunState, SourceJob } from '@/shared/types';
import { NO_MATCHING } from './run-deps';
import { fake } from './setup';

const co = (name: string): Company => ({ name, source: 'greenhouse', boardId: name.toLowerCase(), enabled: true });

function srcJob(c: string, n: number): SourceJob {
  return {
    source: 'greenhouse', sourceJobId: String(n), company: c, title: `Backend Engineer ${n}`,
    url: `https://boards.greenhouse.io/${c}/jobs/${n}`, location: 'Tel Aviv', descriptionText: 'x',
  };
}

function deps(now: Date, fetched: string[] = []): RunDeps {
  return {
    companies: async () => [co('A'), co('B'), co('C')],
    adapter: () => ({
      name: 'greenhouse', applyUrlPatterns: [],
      fetchJobs: async (c) => { fetched.push(c.name); return [srcJob(c.name, 1)]; },
    }),
    now: () => now,
    ...NO_MATCHING,
  };
}

function match(jobId: string, score: number): Match {
  return { jobId, score, bestCvId: 'cv', reasons: ['r'], tips: ['t'], cvVersionHashes: 'h', model: 'm', analyzedAt: '2026-11-04T08:00:00Z' };
}

const finished = (startedAt: string): RunState => ({
  runId: startedAt, kind: 'daily', startedAt, phase: 'done', companiesDone: [], aiQueue: [], aiDone: [],
  callsToday: 0, callsDate: '2026-11-01', errors: [], finishedAt: startedAt,
});

describe('nextRunTime / needsCatchUp', () => {
  it('next runHour:00 strictly after now', () => {
    const at = (s: string) => new Date(s);
    expect(new Date(nextRunTime(at('2026-11-04T06:30:00'), 8))).toEqual(at('2026-11-04T08:00:00'));
    expect(new Date(nextRunTime(at('2026-11-04T08:00:00'), 8))).toEqual(at('2026-11-05T08:00:00'));
    expect(new Date(nextRunTime(at('2026-11-04T21:15:00'), 8))).toEqual(at('2026-11-05T08:00:00'));
    expect(new Date(nextRunTime(at('2026-11-04T21:15:00'), 23))).toEqual(at('2026-11-04T23:00:00'));
  });

  it('catch up only when the last finished run is older than 24h', () => {
    const now = new Date('2026-11-05T10:00:00Z');
    expect(needsCatchUp(undefined, now)).toBe(false);
    expect(needsCatchUp(finished('2026-11-04T09:00:00Z'), now)).toBe(true);
    expect(needsCatchUp(finished('2026-11-04T12:00:00Z'), now)).toBe(false);
    expect(needsCatchUp({ ...finished('2026-11-01T09:00:00Z'), phase: 'ai' }, now)).toBe(false); // resumed instead
    expect(needsCatchUp({ ...finished('2026-11-01T09:00:00Z'), phase: 'error' }, now)).toBe(true);
  });
});

describe('daily alarm', () => {
  it('is created at runHour with a 24h period, kept while valid, moved when runHour changes', async () => {
    const now = new Date('2026-11-04T06:00:00');
    const when = await scheduleDailyAlarm(8, now);
    expect(new Date(when)).toEqual(new Date('2026-11-04T08:00:00'));
    expect(await fake.alarms.get(DAILY_ALARM)).toMatchObject({ scheduledTime: when, periodInMinutes: 1440 });

    expect(await scheduleDailyAlarm(8, now)).toBe(when); // unchanged

    await onSettingsChanged({ runHour: 8 }, { runHour: 18 });
    expect(new Date((await fake.alarms.get(DAILY_ALARM))!.scheduledTime).getHours()).toBe(18);
  });

  it('firing starts a run', async () => {
    const fetched: string[] = [];
    await onAlarm(DAILY_ALARM, deps(new Date('2026-11-04T08:00:00Z'), fetched), {});
    const run = await waitForRun()!;
    expect(run.phase).toBe('done');
    expect(fetched.sort()).toEqual(['A', 'B', 'C']);
  });
});

describe('resume and catch-up', () => {
  it('a run killed mid-fetch resumes on worker start and skips companies already done', async () => {
    const now = new Date('2026-11-04T08:00:00Z');
    const half = await createRun(now);
    half.companiesDone = ['greenhouse:a'];
    await db.runs.put(half);

    const fetched: string[] = [];
    expect(await onBrowserStart(deps(now, fetched), runHooks)).toBe('resumed');
    const final = await waitForRun()!;
    expect(final.runId).toBe(half.runId);
    expect(final.phase).toBe('done');
    expect(fetched.sort()).toEqual(['B', 'C']);
  });

  it('the watchdog alarm exists while a run is active and is cleared when it ends', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const d = deps(new Date('2026-11-04T08:00:00Z'));
    const slow: RunDeps = { ...d, adapter: () => ({ ...d.adapter('greenhouse'), fetchJobs: async (c) => { await gate; return [srcJob(c.name, 1)]; } }) };
    await startOrResumeRun(slow, runHooks);
    await new Promise((r) => setTimeout(r, 0));
    expect(await fake.alarms.get(WATCHDOG_ALARM)).toMatchObject({ periodInMinutes: 1 });
    release();
    await waitForRun();
    expect(await fake.alarms.get(WATCHDOG_ALARM)).toBeUndefined();
  });

  it('the watchdog clears itself when there is nothing to resume', async () => {
    await fake.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 });
    await onAlarm(WATCHDOG_ALARM, deps(new Date()), {});
    expect(await fake.alarms.get(WATCHDOG_ALARM)).toBeUndefined();
    expect(await db.runs.count()).toBe(0);
  });

  it('starts a catch-up run when the last run is older than 24h, and nothing before the first run', async () => {
    const now = new Date('2026-11-06T09:00:00Z');
    expect(await onBrowserStart(deps(now), {})).toBe('none');
    expect(await db.runs.count()).toBe(0);
    expect(await fake.alarms.get(DAILY_ALARM)).toBeDefined();

    await db.runs.put(finished('2026-11-05T08:00:00Z'));
    expect(await onBrowserStart(deps(now), {})).toBe('catch-up');
    const run = await waitForRun()!;
    expect(run.kind).toBe('daily');
    expect(await db.runs.count()).toBe(2);
  });

  it('two triggers at the same moment start only one run', async () => {
    const d = deps(new Date('2026-11-04T08:00:00Z'));
    const [a, b] = await Promise.all([startOrResumeRun(d, {}), startOrResumeRun(d, {})]);
    expect(a!.runId).toBe(b!.runId);
    await waitForRun();
    expect(await db.runs.count()).toBe(1);
  });
});

describe('notification and badge', () => {
  async function seedMatches() {
    const { newIds } = await upsertJobsFromSource([1, 2, 3].map((n) => srcJob('acme', n)), '2026-11-04T08:00:00Z');
    const [a, b, c] = newIds as [string, string, string];
    await saveMatch(match(a, 90));
    await saveMatch(match(b, 70));
    await saveMatch(match(c, 40));
    return { a, b, c };
  }

  it('counts only this run\'s open jobs at or above the threshold', async () => {
    const { a, b, c } = await seedMatches();
    expect(await countNotifiable({ aiDone: [a, b, c] }, 75)).toBe(1);
    expect(await countNotifiable({ aiDone: [a, b, c] }, 60)).toBe(2);
    await db.jobs.update(a, { status: 'applied' });
    expect(await countNotifiable({ aiDone: [a, b, c] }, 60)).toBe(1);
  });

  it('a finished run notifies (Hebrew text) and sets the badge; none when nothing qualifies', async () => {
    await saveSettings({ minScoreToShow: 60, minScoreToNotify: 75 });
    const { a, b, c } = await seedMatches();
    await runHooks.onFinish!({ ...finished('2026-11-04T08:00:00Z'), aiDone: [a, b, c] });
    const notes = await fake.notifications.getAll();
    expect(Object.keys(notes)).toHaveLength(1);
    expect(notificationText(1, 75).message).toContain('משרה חדשה אחת');
    expect(notificationText(3, 75).message).toBe('נמצאו 3 משרות חדשות עם התאמה של 75 ומעלה');
    expect(await fake.action.getBadgeText({})).toBe('2');

    await fake.notifications.clear(Object.keys(notes)[0]!);
    await runHooks.onFinish!({ ...finished('2026-11-04T09:00:00Z'), aiDone: [c] });
    expect(Object.keys(await fake.notifications.getAll())).toHaveLength(0);
  });

  it('viewing jobs on Today clears them from the badge', async () => {
    await saveSettings({ minScoreToShow: 60 });
    const { a, b } = await seedMatches();
    expect(await unviewedMatchCount(60)).toBe(2);
    expect(await refreshBadge()).toBe(2);
    expect(await markJobsViewed([a])).toBe(1);
    expect(await markJobsViewed([b])).toBe(0);
    expect(await fake.action.getBadgeText({})).toBe('');
  });
});
