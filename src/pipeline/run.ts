// Orchestrates a run (SPEC.md section 7). State is persisted to the `runs` table after every company,
// because the MV3 service worker can be killed at any time; executeRun() can be called again on the
// same state to resume. M3 implements the fetch phase; later milestones add prefilter / overlap / ai.
import { db } from '@/db/schema';
import { markClosed, upsertJobsFromSource } from '@/db/repo';
import { companyKey } from '@/shared/companies';
import type { Company, RunState, SourceName } from '@/shared/types';
import { localDateStr, pLimit, uuid } from '@/shared/utils';
import type { SourceAdapter } from '@/sources/types';

export const FETCH_CONCURRENCY = 5;

export interface RunDeps {
  companies(): Promise<Company[]>;
  adapter(source: SourceName): SourceAdapter;
  now(): Date;
}

const ACTIVE_PHASES: RunState['phase'][] = ['fetch', 'prefilter', 'overlap', 'ai'];

export function isActive(run: RunState | undefined): run is RunState {
  return !!run && ACTIVE_PHASES.includes(run.phase);
}

export async function getLatestRun(): Promise<RunState | undefined> {
  return db.runs.orderBy('startedAt').last();
}

/** The newest unfinished run, if any (to resume instead of starting a new one). */
export async function getActiveRun(): Promise<RunState | undefined> {
  const latest = await getLatestRun();
  return isActive(latest) ? latest : undefined;
}

/**
 * New run state. First run ever (no finished run) is 'full', later ones 'daily'.
 * The AI-call counter carries over from the previous run on the same local date.
 */
export async function createRun(now: Date = new Date()): Promise<RunState> {
  const previous = await getLatestRun();
  const hasFinished = (await db.runs.filter((r) => r.phase === 'done').count()) > 0;
  const today = localDateStr(now);
  const state: RunState = {
    runId: uuid(),
    kind: hasFinished ? 'daily' : 'full',
    startedAt: now.toISOString(),
    phase: 'fetch',
    companiesDone: [],
    aiQueue: [],
    aiDone: [],
    callsToday: previous?.callsDate === today ? previous.callsToday : 0,
    callsDate: today,
    errors: [],
    progress: { companiesTotal: 0, jobsSeen: 0, jobsNew: 0, jobsClosed: 0 },
  };
  await db.runs.put(state);
  return state;
}

/** Serializes writes so concurrent company completions never persist out of order. */
function persister(state: RunState, onUpdate?: (s: RunState) => void) {
  let chain = Promise.resolve();
  return () => {
    const snapshot = structuredClone(state);
    chain = chain.then(async () => {
      await db.runs.put(snapshot);
      onUpdate?.(snapshot);
    });
    return chain;
  };
}

function errorMessage(e: unknown): string {
  return e instanceof Error && e.message ? e.message : String(e);
}

async function runFetchPhase(state: RunState, deps: RunDeps, persist: () => Promise<void>): Promise<void> {
  const progress = (state.progress ??= { companiesTotal: 0, jobsSeen: 0, jobsNew: 0, jobsClosed: 0 });
  const companies = (await deps.companies()).filter((c) => c.enabled);
  progress.companiesTotal = companies.length;
  if (companies.length === 0) {
    state.errors.push({ source: 'run', message: 'אין חברות פעילות ברשימה — יש להוסיף חברות בהגדרות', at: deps.now().toISOString() });
    await persist();
    return;
  }

  const done = new Set(state.companiesDone);
  const todo = companies.filter((c) => !done.has(companyKey(c)));
  const limit = pLimit(FETCH_CONCURRENCY);

  await Promise.all(
    todo.map((company) =>
      limit(async () => {
        try {
          const jobs = await deps.adapter(company.source).fetchJobs(company);
          const { newIds, seenIds } = await upsertJobsFromSource(jobs, deps.now().toISOString());
          // Only after a successful fetch: listed-before-but-not-now jobs are closed.
          const closed = await markClosed(company.source, company.name, seenIds);
          progress.jobsSeen += seenIds.length;
          progress.jobsNew += newIds.length;
          progress.jobsClosed += closed;
        } catch (e) {
          state.errors.push({
            source: company.source,
            company: company.name,
            message: errorMessage(e),
            at: deps.now().toISOString(),
          });
        }
        state.companiesDone.push(companyKey(company));
        await persist();
      }),
    ),
  );
}

/**
 * Runs (or resumes) a run until it is done. Never throws for a single company failure;
 * an unexpected failure moves the run to 'error' with the message recorded.
 */
export async function executeRun(
  state: RunState,
  deps: RunDeps,
  onUpdate?: (s: RunState) => void,
): Promise<RunState> {
  const persist = persister(state, onUpdate);
  try {
    if (state.phase === 'fetch') {
      await runFetchPhase(state, deps, persist);
      // M4 continues with prefilter -> overlap -> ai here.
      state.phase = 'done';
    }
    if (state.phase === 'done' && !state.finishedAt) state.finishedAt = deps.now().toISOString();
  } catch (e) {
    state.phase = 'error';
    state.errors.push({ source: 'run', message: errorMessage(e), at: deps.now().toISOString() });
    state.finishedAt = deps.now().toISOString();
  }
  await persist();
  return state;
}

/** Keep the runs table small: delete all but the newest `keep` runs. */
export async function pruneRuns(keep = 30): Promise<void> {
  const old = await db.runs.orderBy('startedAt').reverse().offset(keep).primaryKeys();
  await db.runs.bulkDelete(old);
}
