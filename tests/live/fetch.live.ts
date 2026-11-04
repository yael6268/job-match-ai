// LIVE: hits real Greenhouse / Lever APIs. Run with `npm run test:live`.
import { describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import { createRun, executeRun, type RunDeps } from '@/pipeline/run';
import { getAdapter } from '@/sources';
import type { Company } from '@/shared/types';

const companies: Company[] = [
  { name: 'Riskified', source: 'greenhouse', boardId: 'riskified', enabled: true },
  { name: 'Similarweb', source: 'greenhouse', boardId: 'similarweb', enabled: true },
  { name: 'Taboola', source: 'greenhouse', boardId: 'taboola', enabled: true },
  { name: 'Payoneer', source: 'greenhouse', boardId: 'payoneer', enabled: true },
  { name: 'AppsFlyer', source: 'greenhouse', boardId: 'appsflyer', enabled: true },
  { name: 'WalkMe', source: 'lever', boardId: 'walkme', enabled: true },
  { name: 'Broken Co', source: 'greenhouse', boardId: 'no-such-board-xyz123', enabled: true },
];

const deps: RunDeps = { companies: async () => companies, adapter: getAdapter, now: () => new Date() };

describe('live fetch', () => {
  it('fetches hundreds of jobs, isolates the broken company, and creates no duplicates on re-run', async () => {
    const t0 = Date.now();
    const first = await executeRun(await createRun(), deps);
    const secs = ((Date.now() - t0) / 1000).toFixed(1);
    const byCompany: Record<string, number> = {};
    for (const j of await db.jobs.toArray()) byCompany[j.company] = (byCompany[j.company] ?? 0) + 1;
    console.log(`first run: ${secs}s`, first.progress, byCompany, first.errors);

    expect(first.phase).toBe('done');
    expect(first.progress!.jobsNew).toBeGreaterThan(100);
    expect(first.errors).toHaveLength(1);
    expect(first.errors[0]!.company).toBe('Broken Co');

    const sample = (await db.jobs.where('company').equals('Riskified').first())!;
    console.log('sample job:', { ...sample, descriptionText: `${sample.descriptionText.slice(0, 160)}…` });

    const second = await executeRun(await createRun(), deps);
    console.log('second run:', second.progress);
    expect(second.progress!.jobsNew).toBe(0);
    expect(await db.jobs.count()).toBe(first.progress!.jobsNew);
  });
});
