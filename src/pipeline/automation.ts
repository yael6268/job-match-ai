// Chrome side of the daily automation (SPEC.md section 10): alarms, catch-up/resume on start-up,
// notification + badge when a run ends. Called from the background service worker.
import { browser } from 'wxt/browser';
import { markViewed } from '@/db/repo';
import { getSettings } from '@/shared/storage';
import type { RunState, Settings } from '@/shared/types';
import { isRunning, realDeps, startOrResumeRun, type RunHooks } from './controller';
import { getLatestRun, type RunDeps } from './run';
import {
  countNotifiable, DAILY_ALARM, hourOf, needsCatchUp, nextRunTime, notificationText, unviewedMatchCount, WATCHDOG_ALARM,
} from './schedule';

const BADGE_COLOR = '#3b5bdb';

/** Creates the daily alarm at runHour, or recreates it when the hour changed. Returns its next time. */
export async function scheduleDailyAlarm(runHour: number, now: Date = new Date()): Promise<number> {
  const existing = await browser.alarms.get(DAILY_ALARM);
  if (existing && hourOf(existing.scheduledTime) === runHour && existing.scheduledTime > now.getTime()) {
    return existing.scheduledTime;
  }
  const when = nextRunTime(now, runHour);
  await browser.alarms.create(DAILY_ALARM, { when, periodInMinutes: 24 * 60 });
  return when;
}

/** Badge = unviewed open jobs with a match >= minScoreToShow; empty when there are none. */
export async function refreshBadge(settings?: Settings): Promise<number> {
  const s = settings ?? (await getSettings());
  const n = await unviewedMatchCount(s.minScoreToShow);
  await browser.action.setBadgeText({ text: n > 0 ? String(n) : '' });
  if (n > 0) await browser.action.setBadgeBackgroundColor({ color: BADGE_COLOR });
  return n;
}

/** The Today screen showed these jobs: mark them viewed and update the badge. */
export async function markJobsViewed(jobIds: string[]): Promise<number> {
  if (jobIds.length) await markViewed(jobIds);
  return refreshBadge();
}

export const runHooks: RunHooks = {
  // While a run is unfinished, wake the worker every minute so a killed run resumes by itself.
  onStart: () => browser.alarms.create(WATCHDOG_ALARM, { periodInMinutes: 1 }),
  async onFinish(run: RunState) {
    await browser.alarms.clear(WATCHDOG_ALARM);
    const s = await getSettings();
    if (run.phase === 'done') {
      const n = await countNotifiable(run, s.minScoreToNotify);
      if (n > 0) {
        await browser.notifications.create(`run-${run.runId}`, {
          type: 'basic',
          iconUrl: browser.runtime.getURL('/icon/128.png'),
          ...notificationText(n, s.minScoreToNotify),
        });
      }
    }
    await refreshBadge(s);
  },
};

/** Resume an unfinished run if there is one (any worker wake-up). */
export function resumeIfUnfinished(deps: RunDeps = realDeps, hooks: RunHooks = runHooks) {
  return startOrResumeRun(deps, hooks, { resumeOnly: true });
}

/** runtime.onStartup / onInstalled: make sure the alarm exists, resume or catch up, refresh the badge. */
export async function onBrowserStart(deps: RunDeps = realDeps, hooks: RunHooks = runHooks): Promise<'resumed' | 'catch-up' | 'none'> {
  const now = deps.now();
  const s = await getSettings();
  await scheduleDailyAlarm(s.runHour, now);
  let result: 'resumed' | 'catch-up' | 'none' = 'none';
  if (await resumeIfUnfinished(deps, hooks)) result = 'resumed';
  else if (needsCatchUp(await getLatestRun(), now)) {
    await startOrResumeRun(deps, hooks);
    result = 'catch-up';
  }
  await refreshBadge(s);
  return result;
}

export async function onAlarm(name: string, deps: RunDeps = realDeps, hooks: RunHooks = runHooks): Promise<void> {
  if (name === DAILY_ALARM) {
    await startOrResumeRun(deps, hooks);
  } else if (name === WATCHDOG_ALARM) {
    const r = await resumeIfUnfinished(deps, hooks);
    if (!r && !isRunning()) await browser.alarms.clear(WATCHDOG_ALARM);
  }
}

/** Settings changed: move the alarm when runHour changed; the badge threshold may have changed too. */
export async function onSettingsChanged(oldValue: unknown, newValue: unknown): Promise<void> {
  const oldHour = (oldValue as Partial<Settings> | undefined)?.runHour;
  const next = newValue as Partial<Settings> | undefined;
  if (next?.runHour !== undefined && next.runHour !== oldHour) await scheduleDailyAlarm(next.runHour);
  await refreshBadge();
}
