import { describe, expect, it } from 'vitest';
import { dispatch, isMessage, type Handlers } from '@/shared/messages';
import { startOrResumeRun, waitForRun } from '@/pipeline/controller';
import { db } from '@/db/schema';
import type { RunDeps } from '@/pipeline/run';
import { NO_MATCHING } from './run-deps';

const handlers: Handlers = {
  startRun: async () => { throw new Error('boom'); },
  getRunState: async () => null,
  testCompany: async ({ company }) => ({ count: company.name.length }),
};

describe('dispatch', () => {
  it('wraps results and errors', async () => {
    expect(await dispatch(handlers, { type: 'getRunState' })).toEqual({ ok: true, data: null });
    expect(await dispatch(handlers, { type: 'startRun' })).toEqual({ ok: false, error: 'boom' });
    expect(await dispatch(handlers, {
      type: 'testCompany', company: { name: 'Acme', source: 'lever', boardId: 'acme', enabled: true },
    })).toEqual({ ok: true, data: { count: 4 } });
    expect(await dispatch(handlers, { type: 'nope' } as never)).toMatchObject({ ok: false });
  });

  it('isMessage guards', () => {
    expect(isMessage({ type: 'x' })).toBe(true);
    expect(isMessage(null)).toBe(false);
    expect(isMessage('startRun')).toBe(false);
  });
});

describe('startOrResumeRun', () => {
  it('is single-flight: a second start while running returns the same run', async () => {
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const deps: RunDeps = {
      companies: async () => [{ name: 'A', source: 'greenhouse', boardId: 'a', enabled: true }],
      adapter: () => ({ name: 'greenhouse', applyUrlPatterns: [], fetchJobs: async () => { await gate; return []; } }),
      now: () => new Date(),
      ...NO_MATCHING,
    };
    const first = await startOrResumeRun(deps);
    const second = await startOrResumeRun(deps);
    expect(second.runId).toBe(first.runId);
    release();
    const final = await waitForRun()!;
    expect(final.phase).toBe('done');
    expect(await db.runs.count()).toBe(1);
  });
});
