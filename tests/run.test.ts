import { describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createRun, executeRun, FETCH_CONCURRENCY, getActiveRun, pruneRuns, type RunDeps } from '@/pipeline/run';
import { companyKey } from '@/shared/companies';
import type { Company, RunState, SourceJob, SourceName } from '@/shared/types';
import type { SourceAdapter } from '@/sources/types';
import { sleep } from '@/shared/utils';
import { NO_MATCHING } from './run-deps';

function co(name: string, source: SourceName = 'greenhouse', enabled = true): Company {
  return { name, source, boardId: name.toLowerCase(), enabled };
}

function jobsFor(c: Company, ids: number[]): SourceJob[] {
  return ids.map((n) => ({
    source: c.source, sourceJobId: String(n), company: c.name, title: `Job ${n}`,
    url: `https://example.com/${c.boardId}/jobs/${n}`, location: 'Tel Aviv', descriptionText: 'x',
  }));
}

/** Fake adapter: per-company job ids, failures, and concurrency tracking. */
function fakeDeps(opts: {
  companies: Company[];
  jobs: Record<string, number[]>;
  fail?: Set<string>;
  delayMs?: number;
}) {
  let active = 0;
  const stats = { peak: 0, calls: [] as string[] };
  const adapter: SourceAdapter = {
    name: 'greenhouse',
    applyUrlPatterns: [],
    async fetchJobs(c) {
      stats.calls.push(c.name);
      active++;
      stats.peak = Math.max(stats.peak, active);
      await sleep(opts.delayMs ?? 1);
      active--;
      if (opts.fail?.has(c.name)) throw new Error(`הלוח לא נמצא (404)`);
      return jobsFor(c, opts.jobs[c.name] ?? []);
    },
  };
  const deps: RunDeps = {
    companies: async () => opts.companies,
    adapter: () => adapter,
    now: () => new Date('2026-11-04T08:00:00Z'),
    ...NO_MATCHING,
  };
  return { deps, stats };
}

describe('createRun', () => {
  it('first run is full, later runs are daily; call counter carries over on the same date', async () => {
    const first = await createRun(new Date('2026-11-04T08:00:00'));
    expect(first.kind).toBe('full');
    await db.runs.update(first.runId, { phase: 'done', callsToday: 12 });
    const second = await createRun(new Date('2026-11-04T09:00:00'));
    expect(second.kind).toBe('daily');
    expect(second.callsToday).toBe(12);
    await db.runs.update(second.runId, { phase: 'done' });
    const nextDay = await createRun(new Date('2026-11-05T08:00:00'));
    expect(nextDay.callsToday).toBe(0);
  });
});

describe('executeRun — fetch phase', () => {
  it('fetches every enabled company, counts jobs, and finishes', async () => {
    const companies = [co('A'), co('B'), co('Off', 'greenhouse', false)];
    const { deps, stats } = fakeDeps({ companies, jobs: { A: [1, 2, 3], B: [4, 5], Off: [9] } });
    const run = await executeRun(await createRun(), deps);
    expect(run.phase).toBe('done');
    expect(run.finishedAt).toBeDefined();
    expect(stats.calls.sort()).toEqual(['A', 'B']);
    expect(run.progress).toMatchObject({ companiesTotal: 2, jobsSeen: 5, jobsNew: 5 });
    expect(await db.jobs.count()).toBe(5);
    expect((await db.runs.get(run.runId))!.phase).toBe('done');
  });

  it('a second run creates zero duplicates and zero new jobs', async () => {
    const { deps } = fakeDeps({ companies: [co('A'), co('B')], jobs: { A: [1, 2], B: [3] } });
    await executeRun(await createRun(), deps);
    const second = await executeRun(await createRun(), deps);
    expect(second.kind).toBe('daily');
    expect(second.progress).toMatchObject({ jobsSeen: 3, jobsNew: 0 });
    expect(await db.jobs.count()).toBe(3);
  });

  it('a broken company is recorded as an error without stopping the others', async () => {
    const { deps } = fakeDeps({
      companies: [co('A'), co('Broken'), co('C')],
      jobs: { A: [1], C: [2] },
      fail: new Set(['Broken']),
    });
    const run = await executeRun(await createRun(), deps);
    expect(run.phase).toBe('done');
    expect(run.errors).toEqual([expect.objectContaining({ company: 'Broken', source: 'greenhouse', message: expect.stringContaining('404') })]);
    expect(run.companiesDone).toHaveLength(3);
    expect(await db.jobs.count()).toBe(2);
  });

  it(`never fetches more than ${FETCH_CONCURRENCY} companies at once`, async () => {
    const companies = Array.from({ length: 12 }, (_, i) => co(`C${i}`));
    const { deps, stats } = fakeDeps({ companies, jobs: {}, delayMs: 10 });
    await executeRun(await createRun(), deps);
    expect(stats.calls).toHaveLength(12);
    expect(stats.peak).toBe(FETCH_CONCURRENCY);
  });

  it('closes jobs that disappeared, but not when the company fetch failed', async () => {
    const companies = [co('A'), co('B')];
    await executeRun(await createRun(), fakeDeps({ companies, jobs: { A: [1, 2], B: [3, 4] } }).deps);
    const second = await executeRun(
      await createRun(),
      fakeDeps({ companies, jobs: { A: [1] }, fail: new Set(['B']) }).deps,
    );
    expect(second.progress!.jobsClosed).toBe(1);
    const statuses = (await db.jobs.toArray()).map((j) => `${j.company}:${j.sourceJobId}:${j.status}`).sort();
    expect(statuses).toEqual(['A:1:new', 'A:2:closed', 'B:3:new', 'B:4:new']);
  });

  it('persists state after every company (resumable) and skips companiesDone on resume', async () => {
    const companies = [co('A'), co('B'), co('C')];
    const snapshots: RunState[] = [];
    const { deps } = fakeDeps({ companies, jobs: { A: [1], B: [2], C: [3] } });
    await executeRun(await createRun(), deps, (s) => snapshots.push(s));
    // one write per company, then the phase change and the final write
    expect(snapshots.map((s) => s.companiesDone.length)).toEqual([1, 2, 3, 3, 3]);
    expect(snapshots.at(-1)!.phase).toBe('done');

    // Simulate a killed worker: a run that already did A.
    const half = await createRun();
    half.companiesDone = [companyKey(companies[0]!)];
    await db.runs.put(half);
    expect((await getActiveRun())!.runId).toBe(half.runId);
    const resumed = fakeDeps({ companies, jobs: { A: [1], B: [2], C: [3] } });
    await executeRun(half, resumed.deps);
    expect(resumed.stats.calls.sort()).toEqual(['B', 'C']);
    expect(await getActiveRun()).toBeUndefined();
  });

  it('with no enabled companies, finishes with a readable error', async () => {
    const { deps } = fakeDeps({ companies: [co('Off', 'greenhouse', false)], jobs: {} });
    const run = await executeRun(await createRun(), deps);
    expect(run.phase).toBe('done');
    expect(run.errors[0]!.message).toContain('אין חברות פעילות');
  });

  it('an unexpected failure moves the run to error instead of throwing', async () => {
    const deps: RunDeps = {
      companies: async () => { throw new Error('storage broke'); },
      adapter: () => { throw new Error('unused'); },
      now: () => new Date(),
      ...NO_MATCHING,
    };
    const run = await executeRun(await createRun(), deps);
    expect(run.phase).toBe('error');
    expect(run.errors.at(-1)!.message).toBe('storage broke');
  });
});

describe('pruneRuns', () => {
  it('keeps only the newest N', async () => {
    for (let i = 0; i < 5; i++) await createRun(new Date(2026, 10, i + 1));
    await pruneRuns(2);
    const left = await db.runs.orderBy('startedAt').toArray();
    expect(left.map((r) => new Date(r.startedAt).getDate())).toEqual([4, 5]);
  });
});
