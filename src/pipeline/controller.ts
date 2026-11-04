// Single-flight run controller used by the background service worker.
import { getCompanies } from '@/shared/companies';
import type { RunState } from '@/shared/types';
import { getAdapter } from '@/sources';
import { createRun, executeRun, getActiveRun, getLatestRun, pruneRuns, type RunDeps } from './run';

export const realDeps: RunDeps = {
  companies: getCompanies,
  adapter: getAdapter,
  now: () => new Date(),
};

let inFlight: Promise<RunState> | null = null;

/**
 * Starts a run, or resumes an unfinished one found in the DB, unless one is already running in
 * this worker. Returns immediately with the current state; the run continues in the background.
 */
export async function startOrResumeRun(deps: RunDeps = realDeps): Promise<RunState> {
  if (inFlight) return (await getLatestRun())!;
  const state = (await getActiveRun()) ?? (await createRun(deps.now()));
  inFlight = executeRun(state, deps)
    .then(async (final) => {
      await pruneRuns();
      return final;
    })
    .finally(() => {
      inFlight = null;
    });
  return state;
}

export function isRunning(): boolean {
  return inFlight !== null;
}

/** For tests: wait until the current run finishes. */
export function waitForRun(): Promise<RunState> | null {
  return inFlight;
}
