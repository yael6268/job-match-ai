// Daily automation (SPEC.md section 10): when to run, when to catch up, what to notify. Pure helpers
// plus DB queries; the Chrome API calls live in automation.ts.
import { db } from '@/db/schema';
import type { RunState } from '@/shared/types';

export const DAILY_ALARM = 'daily-run';
/** Fires every minute while a run is unfinished, to resume it if the service worker was killed. */
export const WATCHDOG_ALARM = 'run-watchdog';
const DAY_MS = 24 * 60 * 60 * 1000;

/** Next local time at runHour:00 that is strictly after `now` (ms since epoch). */
export function nextRunTime(now: Date, runHour: number): number {
  const t = new Date(now);
  t.setHours(runHour, 0, 0, 0);
  if (t.getTime() <= now.getTime()) t.setDate(t.getDate() + 1);
  return t.getTime();
}

/** The local hour an alarm time falls on (to tell whether the alarm matches the current runHour). */
export function hourOf(ms: number): number {
  return new Date(ms).getHours();
}

/**
 * On browser start / install: a catch-up run is due when the last run finished long ago (more than
 * 24h after it started), so a day missed while the computer was off is not lost. Never before the
 * first manual run, so nothing starts before the user set things up.
 */
export function needsCatchUp(latest: RunState | undefined, now: Date): boolean {
  // Unfinished runs are resumed, not caught up.
  if (!latest || (latest.phase !== 'done' && latest.phase !== 'error')) return false;
  return now.getTime() - new Date(latest.startedAt).getTime() > DAY_MS;
}

/** Jobs this run analyzed that are still open and scored at least `minScore` (for the notification). */
export async function countNotifiable(run: Pick<RunState, 'aiDone'>, minScore: number): Promise<number> {
  const ids = [...new Set(run.aiDone)];
  const [jobs, matches] = await Promise.all([db.jobs.bulkGet(ids), db.matches.bulkGet(ids)]);
  return ids.filter((_, i) => jobs[i]?.status === 'new' && (matches[i]?.score ?? -1) >= minScore).length;
}

/** Badge count: open jobs with a match >= minScore that the user has not seen on the Today screen. */
export async function unviewedMatchCount(minScore: number): Promise<number> {
  const jobs = await db.jobs.where('status').equals('new').filter((j) => !j.viewed).toArray();
  const matches = await db.matches.bulkGet(jobs.map((j) => j.id));
  return matches.filter((m) => (m?.score ?? -1) >= minScore).length;
}

export function notificationText(count: number, minScore: number): { title: string; message: string } {
  return {
    title: 'Job Match AI',
    message: count === 1
      ? `נמצאה משרה חדשה אחת עם התאמה של ${minScore} ומעלה`
      : `נמצאו ${count} משרות חדשות עם התאמה של ${minScore} ומעלה`,
  };
}
