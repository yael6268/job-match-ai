// Orchestrates a run (SPEC.md section 7): fetch -> prefilter -> overlap -> ai -> done.
// State is persisted to the `runs` table after every company and every AI call, because the MV3
// service worker can be killed at any time; executeRun() can be called again on the same state to
// resume. The prefilter and overlap phases are idempotent, so resuming simply re-runs them.
import { db } from '@/db/schema';
import { getMatch, markClosed, saveMatch, upsertJobsFromSource } from '@/db/repo';
import { AiInvalidOutput, CallBudgetExhausted, type AiMatcher } from '@/ai/gemini';
import { companyKey } from '@/shared/companies';
import { DOMAINS, type Company, type CV, type Job, type RunState, type Settings, type SourceName } from '@/shared/types';
import { localDateStr, pLimit, uuid } from '@/shared/utils';
import type { SourceAdapter } from '@/sources/types';
import { extractRequiredYears } from './experience';
import { bestOverlap, tokenize } from './overlap';
import { prefilterJob } from './prefilter';

export const FETCH_CONCURRENCY = 5;

export interface RunDeps {
  companies(): Promise<Company[]>;
  adapter(source: SourceName): SourceAdapter;
  now(): Date;
  settings(): Promise<Settings>;
  cvs(): Promise<CV[]>;
  /** `beforeCall` must run before every AI HTTP call (daily cap + call counting). */
  createMatcher(settings: Settings, beforeCall: () => Promise<void>): AiMatcher;
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

/** Jobs still waiting for AI in a run (queued but not done). */
export function pendingAi(run: Pick<RunState, 'aiQueue' | 'aiDone'>): string[] {
  const done = new Set(run.aiDone);
  return run.aiQueue.filter((id) => !done.has(id));
}

/** Cache key for matches: the versionHash of every CV, in a stable order. Changes when any CV changes. */
export function cvVersionKey(cvs: Pick<CV, 'id' | 'versionHash'>[]): string {
  return [...cvs].sort((a, b) => a.id.localeCompare(b.id)).map((c) => c.versionHash).join(',');
}

/**
 * New run state. First run ever (no finished run) is 'full', later ones 'daily'.
 * The AI-call counter carries over from the previous run on the same local date, and so do jobs
 * the previous run queued for AI but could not analyze (daily cap reached).
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
    aiQueue: previous ? pendingAi(previous) : [],
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

function progressOf(state: RunState) {
  return (state.progress ??= { companiesTotal: 0, jobsSeen: 0, jobsNew: 0, jobsClosed: 0 });
}

// ---------- phase 1: fetch ----------

async function runFetchPhase(state: RunState, deps: RunDeps, persist: () => Promise<void>): Promise<void> {
  const progress = progressOf(state);
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

// ---------- phase 2: prefilter (new jobs only, no AI) ----------

/**
 * Jobs to match in this run: open ('new') jobs first seen at or after the run started, plus any that
 * never went through the prefilter (fetched while there were no CVs, or before matching existed).
 * Derived from the DB rather than kept in the state, so a worker killed between an upsert and the
 * next persist loses nothing.
 */
async function newJobsOfRun(state: RunState): Promise<Job[]> {
  return db.jobs
    .where('status')
    .equals('new')
    .filter((j) => j.firstSeenAt >= state.startedAt || j.prefilterPassed === undefined)
    .toArray();
}

async function runPrefilterPhase(state: RunState, settings: Settings, cvs: CV[]): Promise<void> {
  const jobs = await newJobsOfRun(state);
  const chosen = new Set(cvs.flatMap((c) => c.domains));
  // CVs without any domain chosen: don't drop every job, check titles against all domains.
  const cvDomains = chosen.size ? chosen : new Set<string>(DOMAINS);
  const passed: string[] = [];
  await db.transaction('rw', db.jobs, async () => {
    for (const job of jobs) {
      const requiredYears = job.requiredYears ?? extractRequiredYears(job.descriptionText);
      const r = prefilterJob({ ...job, requiredYears }, { settings, cvDomains });
      await db.jobs.update(job.id, { requiredYears, prefilterPassed: r.passed });
      if (r.passed) passed.push(job.id);
    }
  });
  state.prefilterPassedIds = passed;
  progressOf(state).jobsPassedPrefilter = passed.length;
}

// ---------- phase 3: overlap (no AI) -> aiQueue ----------

async function runOverlapPhase(state: RunState, settings: Settings, cvs: CV[]): Promise<void> {
  const key = cvVersionKey(cvs);
  const fresh = (await db.jobs.bulkGet(state.prefilterPassedIds ?? [])).filter(
    (j): j is Job => !!j && j.status === 'new',
  );
  // Jobs analyzed with an older version of the CVs get re-analyzed (they are still open and unhandled).
  const staleIds = await db.matches.filter((m) => m.cvVersionHashes !== key).primaryKeys();
  const stale = (await db.jobs.bulkGet(staleIds)).filter((j): j is Job => !!j && j.status === 'new');

  const queued = new Set(state.aiQueue);
  const pool = new Map<string, Job>();
  for (const j of [...fresh, ...stale]) if (!queued.has(j.id)) pool.set(j.id, j);

  const cvTokens = cvs.map((c) => tokenize(c.text));
  const scored = [...pool.values()].map((j) => ({
    id: j.id,
    score: bestOverlap(`${j.title}\n${j.descriptionText}`, cvTokens),
  }));
  await db.transaction('rw', db.jobs, async () => {
    for (const s of scored) await db.jobs.update(s.id, { overlapScore: s.score });
  });

  const top = scored
    .sort((a, b) => b.score - a.score)
    .slice(0, settings.maxAiCandidatesPerRun)
    .map((s) => s.id);
  state.aiQueue = [...state.aiQueue, ...top];
  progressOf(state).aiQueued = state.aiQueue.length;
}

// ---------- phase 4: ai ----------

async function runAiPhase(
  state: RunState,
  deps: RunDeps,
  settings: Settings,
  cvs: CV[],
  persist: () => Promise<void>,
): Promise<void> {
  const todo = pendingAi(state);
  if (todo.length === 0) return;
  if (!settings.geminiApiKey.trim() || !settings.geminiModel) {
    state.errors.push({
      source: 'ai',
      message: `לא הוגדרו מפתח API ומודל — ${todo.length} משרות ממתינות לניתוח (הגדרות ← Gemini)`,
      at: deps.now().toISOString(),
    });
    return;
  }

  const beforeCall = async () => {
    const today = localDateStr(deps.now());
    if (state.callsDate !== today) {
      state.callsDate = today;
      state.callsToday = 0;
    }
    if (state.callsToday >= settings.dailyCallLimit) throw new CallBudgetExhausted();
    state.callsToday++;
    await persist();
  };
  const matcher = deps.createMatcher(settings, beforeCall);
  const key = cvVersionKey(cvs);

  for (const jobId of todo) {
    const job = await db.jobs.get(jobId);
    const cached = await getMatch(jobId);
    // Gone, handled meanwhile, or already analyzed with these exact CVs: nothing to do.
    if (!job || job.status !== 'new' || cached?.cvVersionHashes === key) {
      state.aiDone.push(jobId);
      continue;
    }
    try {
      const out = await matcher.match(job, cvs);
      await saveMatch({
        jobId,
        score: out.score,
        bestCvId: out.bestCvId,
        reasons: out.reasons,
        tips: out.tips,
        requiredYears: out.requiredYears ?? job.requiredYears,
        cvVersionHashes: key,
        model: matcher.model,
        analyzedAt: deps.now().toISOString(),
      });
      state.aiDone.push(jobId);
    } catch (e) {
      if (e instanceof AiInvalidOutput) {
        // ai_failed: skip this job and move on.
        state.errors.push({
          source: 'ai',
          company: job.company,
          message: `ai_failed — "${job.title}": ${e.message}`,
          at: deps.now().toISOString(),
        });
        state.aiDone.push(jobId);
      } else {
        // Daily cap, quota after backoff, bad key, offline: stop; the rest stays queued for the next run.
        state.errors.push({ source: 'ai', message: errorMessage(e), at: deps.now().toISOString() });
        await persist();
        return;
      }
    }
    await persist();
  }
}

// ---------- driver ----------

/**
 * Runs (or resumes) a run until it is done. Never throws for a single company or job failure;
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
      state.phase = 'prefilter';
      await persist();
    }
    if (state.phase === 'prefilter' || state.phase === 'overlap' || state.phase === 'ai') {
      const [settings, cvs] = await Promise.all([deps.settings(), deps.cvs()]);
      if (cvs.length === 0) {
        // Nothing to match against; the Today screen shows the "upload a CV" empty state.
        state.phase = 'done';
      } else {
        if (state.phase === 'prefilter') {
          await runPrefilterPhase(state, settings, cvs);
          state.phase = 'overlap';
          await persist();
        }
        if (state.phase === 'overlap') {
          await runOverlapPhase(state, settings, cvs);
          state.phase = 'ai';
          await persist();
        }
        if (state.phase === 'ai') {
          await runAiPhase(state, deps, settings, cvs, persist);
          state.phase = 'done';
        }
      }
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
