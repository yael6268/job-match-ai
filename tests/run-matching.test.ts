import { describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { AiInvalidOutput, type AiMatcher } from '@/ai/gemini';
import type { MatchOutput } from '@/ai/schemas';
import { createRun, cvVersionKey, executeRun, pendingAi, type RunDeps } from '@/pipeline/run';
import { DEFAULT_SETTINGS } from '@/shared/storage';
import type { Company, CV, RunState, Settings, SourceJob } from '@/shared/types';

const acme: Company = { name: 'Acme', source: 'greenhouse', boardId: 'acme', enabled: true };

interface Spec { n: number; title: string; location?: string; text?: string }

function srcJob(s: Spec): SourceJob {
  return {
    source: 'greenhouse', sourceJobId: String(s.n), company: 'Acme', title: s.title,
    url: `https://boards.greenhouse.io/acme/jobs/${s.n}`, location: s.location ?? 'Tel Aviv, Israel',
    descriptionText: s.text ?? 'Selenium Python automation',
  };
}

function cv(id: string, hash: string, domains = ['QA'], text = 'Selenium Playwright Python pytest Jenkins automation'): CV {
  return {
    id, name: id.toUpperCase(), domains, fileName: `${id}.pdf`, fileBlob: new Blob(['x']),
    text, redactedText: text, versionHash: hash, updatedAt: '2026-11-01T00:00:00.000Z',
  };
}

/** Fake Gemini: scores by title, records calls, optional failures. Counts calls through beforeCall like the real one. */
function fakeAi(fail: Record<string, Error> = {}) {
  const calls: string[] = [];
  const create: RunDeps['createMatcher'] = (_s, beforeCall): AiMatcher => ({
    model: 'fake-flash',
    async match(job, cvs): Promise<MatchOutput> {
      await beforeCall();
      calls.push(job.title);
      const err = fail[job.title];
      if (err) throw err;
      return { score: 80, bestCvId: cvs[0]!.id, requiredYears: null, reasons: ['טוב'], tips: ['טיפ'] };
    },
  });
  return { calls, create };
}

let clock = new Date('2026-11-04T08:00:00Z');

function deps(opts: {
  jobs: Spec[];
  cvs: CV[];
  settings?: Partial<Settings>;
  ai?: ReturnType<typeof fakeAi>;
}): RunDeps {
  const ai = opts.ai ?? fakeAi();
  return {
    companies: async () => [acme],
    adapter: () => ({ name: 'greenhouse', applyUrlPatterns: [], fetchJobs: async () => opts.jobs.map(srcJob) }),
    now: () => clock,
    settings: async () => ({ ...DEFAULT_SETTINGS, geminiApiKey: 'k', geminiModel: 'fake-flash', ...opts.settings }),
    cvs: async () => opts.cvs,
    createMatcher: ai.create,
  };
}

async function run(d: RunDeps, onUpdate?: (s: RunState) => void) {
  return executeRun(await createRun(clock), d, onUpdate);
}

const tick = (ms: number) => { clock = new Date(clock.getTime() + ms); };

describe('matching pipeline', () => {
  it('prefilters new jobs, scores overlap, analyzes the survivors and saves matches', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi();
    const cvs = [cv('qa', 'h1')];
    const r = await run(deps({
      cvs, ai,
      jobs: [
        { n: 1, title: 'QA Automation Engineer' },
        { n: 2, title: 'Account Executive' }, // title
        { n: 3, title: 'QA Engineer', location: 'London, UK' }, // location
        { n: 4, title: 'Staff QA Engineer' }, // excluded
        { n: 5, title: 'QA Lead', text: '8+ years of experience in QA' }, // experience
      ],
    }));
    expect(r.phase).toBe('done');
    expect(r.errors).toEqual([]);
    expect(ai.calls).toEqual(['QA Automation Engineer']);
    expect(r.progress).toMatchObject({ jobsNew: 5, jobsPassedPrefilter: 1, aiQueued: 1 });
    expect(r.aiDone).toHaveLength(1);
    expect(r.callsToday).toBe(1);

    const jobs = Object.fromEntries((await db.jobs.toArray()).map((j) => [j.sourceJobId, j]));
    expect(jobs['1']).toMatchObject({ prefilterPassed: true });
    expect(jobs['1']!.overlapScore).toBeGreaterThan(0);
    expect(jobs['5']).toMatchObject({ prefilterPassed: false, requiredYears: 8 });

    const match = (await db.matches.get(jobs['1']!.id))!;
    expect(match).toMatchObject({ score: 80, bestCvId: 'qa', model: 'fake-flash', cvVersionHashes: cvVersionKey(cvs) });
  });

  it('re-running does not call Gemini again for the same jobs', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi();
    const d = deps({ cvs: [cv('qa', 'h1')], ai, jobs: [{ n: 1, title: 'QA Engineer' }, { n: 2, title: 'QA Analyst' }] });
    await run(d);
    expect(ai.calls).toHaveLength(2);
    tick(60_000);
    const second = await run(d);
    expect(second.kind).toBe('daily');
    expect(ai.calls).toHaveLength(2);
    expect(second.callsToday).toBe(2); // carried over, not increased
  });

  it('changing a CV re-analyzes the open jobs', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi();
    const jobs = [{ n: 1, title: 'QA Engineer' }];
    await run(deps({ cvs: [cv('qa', 'h1')], ai, jobs }));
    tick(60_000);
    const changed = [cv('qa', 'h2')];
    await run(deps({ cvs: changed, ai, jobs }));
    expect(ai.calls).toEqual(['QA Engineer', 'QA Engineer']);
    const [match] = await db.matches.toArray();
    expect(match!.cvVersionHashes).toBe(cvVersionKey(changed));
  });

  it('sends only the top maxAiCandidatesPerRun jobs by overlap', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi();
    await run(deps({
      cvs: [cv('qa', 'h1')], ai, settings: { maxAiCandidatesPerRun: 2 },
      jobs: [
        { n: 1, title: 'QA Engineer A', text: 'Kotlin Swift Rust Erlang' },
        { n: 2, title: 'QA Engineer B', text: 'Selenium Playwright Python pytest' },
        { n: 3, title: 'QA Engineer C', text: 'Selenium Jenkins Haskell' },
        { n: 4, title: 'QA Engineer D', text: 'Fortran Cobol Pascal' },
      ],
    }));
    expect(ai.calls).toEqual(['QA Engineer B', 'QA Engineer C']);
  });

  it('stops at the daily cap and carries the rest into the next run', async () => {
    clock = new Date('2026-11-04T08:00:00');
    const ai = fakeAi();
    const d = deps({
      cvs: [cv('qa', 'h1')], ai, settings: { dailyCallLimit: 2 },
      jobs: [1, 2, 3].map((n) => ({ n, title: `QA Engineer ${n}` })),
    });
    const first = await run(d);
    expect(ai.calls).toHaveLength(2);
    expect(first.phase).toBe('done');
    expect(pendingAi(first)).toHaveLength(1);
    expect(first.errors.at(-1)!.message).toContain('מגבלת קריאות');

    // Same day: still capped, nothing new is sent.
    tick(60 * 60_000);
    await run(d);
    expect(ai.calls).toHaveLength(2);

    // Next day: the counter resets and the leftover job is analyzed.
    clock = new Date('2026-11-05T08:00:00');
    const third = await run(d);
    expect(ai.calls).toHaveLength(3);
    expect(third.callsToday).toBe(1);
    expect(pendingAi(third)).toEqual([]);
    expect(await db.matches.count()).toBe(3);
  });

  it('an invalid AI answer marks that job ai_failed and moves on', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi({ 'QA Engineer 1': new AiInvalidOutput('invalid match output: tips Required') });
    const r = await run(deps({ cvs: [cv('qa', 'h1')], ai, jobs: [1, 2].map((n) => ({ n, title: `QA Engineer ${n}` })) }));
    expect(ai.calls).toHaveLength(2);
    expect(r.errors).toEqual([expect.objectContaining({ source: 'ai', message: expect.stringContaining('ai_failed') })]);
    expect(pendingAi(r)).toEqual([]);
    expect(await db.matches.count()).toBe(1);
  });

  it('other AI errors stop the phase and keep the queue', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi({ 'QA Engineer 1': new Error('מפתח ה-API אינו תקין') });
    const r = await run(deps({ cvs: [cv('qa', 'h1')], ai, jobs: [1, 2].map((n) => ({ n, title: `QA Engineer ${n}` })) }));
    expect(r.phase).toBe('done');
    expect(ai.calls).toHaveLength(1);
    expect(pendingAi(r)).toHaveLength(2);
    expect(r.errors.at(-1)!.message).toContain('מפתח');
  });

  it('without an API key the jobs wait in the queue with a readable message', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi();
    const r = await run(deps({ cvs: [cv('qa', 'h1')], ai, settings: { geminiApiKey: '' }, jobs: [{ n: 1, title: 'QA Engineer' }] }));
    expect(ai.calls).toEqual([]);
    expect(pendingAi(r)).toHaveLength(1);
    expect(r.errors[0]!.message).toContain('מפתח API');
  });

  it('without CVs the run finishes after fetching, with no AI', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi();
    const r = await run(deps({ cvs: [], ai, jobs: [{ n: 1, title: 'QA Engineer' }] }));
    expect(r.phase).toBe('done');
    expect(r.errors).toEqual([]);
    expect(ai.calls).toEqual([]);
  });

  it('jobs fetched before any CV existed are matched once a CV is added, and only once', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi();
    const jobs = [{ n: 1, title: 'QA Engineer' }, { n: 2, title: 'Account Executive' }];
    await run(deps({ cvs: [], ai, jobs }));
    expect(ai.calls).toEqual([]);
    tick(60_000);
    const withCv = deps({ cvs: [cv('qa', 'h1')], ai, jobs });
    const second = await run(withCv);
    expect(second.progress).toMatchObject({ jobsNew: 0, jobsPassedPrefilter: 1 });
    expect(ai.calls).toEqual(['QA Engineer']);
    tick(60_000);
    const third = await run(withCv);
    expect(third.progress!.jobsPassedPrefilter).toBe(0); // already prefiltered, not new
    expect(ai.calls).toEqual(['QA Engineer']);
  });

  it('CVs without chosen domains still match titles from every domain', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi();
    await run(deps({ cvs: [cv('x', 'h1', [])], ai, jobs: [{ n: 1, title: 'Backend Engineer' }, { n: 2, title: 'Account Executive' }] }));
    expect(ai.calls).toEqual(['Backend Engineer']);
  });

  it('persists after every AI call and resumes without repeating done jobs', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi();
    const d = deps({ cvs: [cv('qa', 'h1')], ai, jobs: [1, 2, 3].map((n) => ({ n, title: `QA Engineer ${n}` })) });
    const snaps: RunState[] = [];
    const r = await run(d, (s) => snaps.push(s));
    const aiSnaps = snaps.filter((s) => s.phase === 'ai').map((s) => s.aiDone.length);
    expect(Math.max(...aiSnaps)).toBe(3);
    expect(new Set(aiSnaps).size).toBeGreaterThanOrEqual(3); // written as each job finished

    // Simulate a worker killed after the first AI job: rewind the state and resume it.
    const killed: RunState = { ...structuredClone(r), phase: 'ai', aiDone: r.aiDone.slice(0, 1), finishedAt: undefined };
    await db.matches.clear();
    const resumedAi = fakeAi();
    await executeRun(killed, { ...d, createMatcher: resumedAi.create });
    expect(resumedAi.calls).toHaveLength(2);
  });

  it('skips queued jobs the user already handled', async () => {
    clock = new Date('2026-11-04T08:00:00Z');
    const ai = fakeAi();
    const d = deps({ cvs: [cv('qa', 'h1')], ai, settings: { geminiApiKey: '' }, jobs: [{ n: 1, title: 'QA Engineer' }] });
    const first = await run(d);
    expect(pendingAi(first)).toHaveLength(1);
    await db.jobs.toCollection().modify({ status: 'applied' });
    tick(60_000);
    const second = await run({ ...d, settings: async () => ({ ...DEFAULT_SETTINGS, geminiApiKey: 'k', geminiModel: 'm' }) });
    expect(ai.calls).toEqual([]);
    expect(pendingAi(second)).toEqual([]);
  });
});
