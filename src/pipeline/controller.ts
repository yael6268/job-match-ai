// Single-flight run controller used by the background service worker.
import { createGeminiMatcher } from '@/ai/gemini';
import { listCvs } from '@/db/repo';
import { getCompanies } from '@/shared/companies';
import { getSettings } from '@/shared/storage';
import type { RunState } from '@/shared/types';
import { getAdapter } from '@/sources';
import { createRun, executeRun, getActiveRun, getLatestRun, pruneRuns, type RunDeps } from './run';

export const realDeps: RunDeps = {
  companies: getCompanies,
  adapter: getAdapter,
  now: () => new Date(),
  settings: getSettings,
  cvs: listCvs,
  createMatcher: (s, beforeCall) =>
    createGeminiMatcher({
      apiKey: s.geminiApiKey,
      model: s.geminiModel,
      minDelayMs: s.aiDelaySeconds * 1000,
      beforeCall,
    }),
};

/** Side effects around a run (alarms, notification, badge), supplied by the background. */
export interface RunHooks {
  onStart?(run: RunState): void | Promise<void>;
  onFinish?(run: RunState): void | Promise<void>;
}

let inFlight: Promise<RunState> | null = null;
/** Set synchronously while a start is being prepared, so two triggers at once never start two runs. */
let starting: Promise<RunState | null> | null = null;

function launch(state: RunState, deps: RunDeps, hooks: RunHooks): void {
  inFlight = (async () => {
    await hooks.onStart?.(state);
    const final = await executeRun(state, deps);
    await pruneRuns();
    try {
      await hooks.onFinish?.(final);
    } catch (e) {
      console.error('onFinish failed', e);
    }
    return final;
  })().finally(() => {
    inFlight = null;
  });
}

/**
 * Starts a run, or resumes an unfinished one found in the DB, unless one is already running in this
 * worker. With `resumeOnly`, nothing new is created (used on worker start-up and by the watchdog).
 * Returns the current run (null only for resumeOnly with nothing to resume); the run continues in
 * the background.
 */
export function startOrResumeRun(
  deps: RunDeps = realDeps,
  hooks: RunHooks = {},
  opts: { resumeOnly?: boolean } = {},
): Promise<RunState | null> {
  if (inFlight) return getLatestRun().then((r) => r ?? null);
  if (starting) return starting;
  starting = (async () => {
    const active = await getActiveRun();
    if (!active && opts.resumeOnly) return null;
    const state = active ?? (await createRun(deps.now()));
    launch(state, deps, hooks);
    return state;
  })().finally(() => {
    starting = null;
  });
  return starting;
}

export function isRunning(): boolean {
  return inFlight !== null;
}

/** For tests: wait until the current run finishes. */
export function waitForRun(): Promise<RunState> | null {
  return inFlight;
}
