import { describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import {
  addApplication, clearAll, exportAll, getJobsForToday, getMatch, getStats, importAll,
  markClosed, markViewed, renameCompanyJobs, saveMatch, setStatus, upsertJobsFromSource,
} from '@/db/repo';
import type { CV, Match, SourceJob } from '@/shared/types';
import { jobIdFromUrl } from '@/shared/utils';

function srcJob(n: number, over: Partial<SourceJob> = {}): SourceJob {
  return {
    source: 'greenhouse',
    sourceJobId: String(n),
    company: 'Acme',
    title: `QA Engineer ${n}`,
    url: `https://boards.greenhouse.io/acme/jobs/${n}`,
    location: 'Tel Aviv, Israel',
    descriptionText: 'Test things',
    ...over,
  };
}

function match(jobId: string, score: number): Match {
  return {
    jobId, score, bestCvId: 'cv1', reasons: ['r'], tips: ['t'],
    cvVersionHashes: 'h1', model: 'test-model', analyzedAt: '2026-11-04T08:00:00.000Z',
  };
}

const T1 = '2026-11-01T08:00:00.000Z';
const T2 = '2026-11-02T08:00:00.000Z';

describe('upsertJobsFromSource', () => {
  it('inserts new jobs with lifecycle fields', async () => {
    const res = await upsertJobsFromSource([srcJob(1), srcJob(2)], T1);
    expect(res.newIds).toHaveLength(2);
    const job = await db.jobs.get(res.newIds[0]!);
    expect(job).toMatchObject({ status: 'new', viewed: false, firstSeenAt: T1, lastSeenAt: T1 });
    expect(job!.id).toBe(await jobIdFromUrl(srcJob(1).url));
  });

  it('a second run with the same jobs creates no duplicates and no new ids', async () => {
    await upsertJobsFromSource([srcJob(1), srcJob(2)], T1);
    const res = await upsertJobsFromSource([srcJob(1), srcJob(2)], T2);
    expect(res.newIds).toEqual([]);
    expect(res.seenIds).toHaveLength(2);
    expect(await db.jobs.count()).toBe(2);
  });

  it('treats URLs differing only by tracking params as the same job', async () => {
    await upsertJobsFromSource([srcJob(1)], T1);
    const res = await upsertJobsFromSource([srcJob(1, { url: `${srcJob(1).url}?gh_src=li` })], T2);
    expect(res.newIds).toEqual([]);
    expect(await db.jobs.count()).toBe(1);
  });

  it('dedupes the same URL within one batch', async () => {
    const res = await upsertJobsFromSource([srcJob(1), srcJob(1, { title: 'dup' })], T1);
    expect(res.newIds).toHaveLength(1);
    expect((await db.jobs.get(res.newIds[0]!))!.title).toBe('QA Engineer 1');
  });

  it('updates lastSeenAt and source fields but never status, viewed or firstSeenAt', async () => {
    const { newIds } = await upsertJobsFromSource([srcJob(1)], T1);
    const id = newIds[0]!;
    await setStatus(id, 'applied');
    await markViewed([id]);
    await db.jobs.update(id, { overlapScore: 0.7 });
    await upsertJobsFromSource([srcJob(1, { title: 'QA Engineer (renamed)' })], T2);
    const job = (await db.jobs.get(id))!;
    expect(job).toMatchObject({
      status: 'applied', viewed: true, firstSeenAt: T1, lastSeenAt: T2,
      title: 'QA Engineer (renamed)', overlapScore: 0.7,
    });
  });

  it('re-opens a closed job that is listed again', async () => {
    const { newIds } = await upsertJobsFromSource([srcJob(1)], T1);
    await setStatus(newIds[0]!, 'closed');
    const res = await upsertJobsFromSource([srcJob(1)], T2);
    expect(res.newIds).toEqual([]);
    expect((await db.jobs.get(newIds[0]!))!.status).toBe('new');
  });
});

describe('markClosed', () => {
  it('closes only new/saved jobs of that source+company that are no longer listed', async () => {
    const [a, b, c, d] = await Promise.all([1, 2, 3, 4].map((n) => jobIdFromUrl(srcJob(n).url)));
    const other = srcJob(5, { company: 'Other' });
    const lever = srcJob(6, { source: 'lever', url: 'https://jobs.lever.co/acme/6' });
    await upsertJobsFromSource([srcJob(1), srcJob(2), srcJob(3), srcJob(4), other, lever], T1);
    await setStatus(b!, 'saved');
    await setStatus(c!, 'applied');

    const closed = await markClosed('greenhouse', 'Acme', [d!]);
    expect(closed).toBe(2);
    expect((await db.jobs.get(a!))!.status).toBe('closed');
    expect((await db.jobs.get(b!))!.status).toBe('closed');
    expect((await db.jobs.get(c!))!.status).toBe('applied');
    expect((await db.jobs.get(d!))!.status).toBe('new');
    const rest = await db.jobs.where('company').equals('Other').first();
    expect(rest!.status).toBe('new');
    expect((await db.jobs.where('source').equals('lever').first())!.status).toBe('new');
  });
});

describe('renameCompanyJobs', () => {
  it('moves only that source\'s jobs to the new name, so markClosed still finds them', async () => {
    const lever = srcJob(9, { source: 'lever', url: 'https://jobs.lever.co/acme/9' });
    await upsertJobsFromSource([srcJob(1), srcJob(2), lever], T1);
    const [a, b] = await Promise.all([1, 2].map((n) => jobIdFromUrl(srcJob(n).url)));

    expect(await renameCompanyJobs('greenhouse', 'Acme', 'Acme Inc')).toBe(2);
    expect((await db.jobs.where('company').equals('Acme').toArray()).map((j) => j.source)).toEqual(['lever']);

    // Next run lists only job 2 under the new name: job 1 must close.
    expect(await markClosed('greenhouse', 'Acme Inc', [b!])).toBe(1);
    expect((await db.jobs.get(a!))!.status).toBe('closed');
    expect((await db.jobs.get(b!))!.company).toBe('Acme Inc');
  });

  it('is a no-op when the name did not change', async () => {
    await upsertJobsFromSource([srcJob(1)], T1);
    expect(await renameCompanyJobs('greenhouse', 'Acme', 'Acme')).toBe(0);
  });
});

describe('getJobsForToday', () => {
  it('returns new jobs with a match >= threshold, best first', async () => {
    const { newIds } = await upsertJobsFromSource([1, 2, 3, 4].map((n) => srcJob(n)), T1);
    const [a, b, c, d] = newIds as [string, string, string, string];
    await saveMatch(match(a, 70));
    await saveMatch(match(b, 90));
    await saveMatch(match(c, 40)); // below threshold
    await saveMatch(match(d, 95));
    await setStatus(d, 'dismissed'); // not new
    const list = await getJobsForToday(60);
    expect(list.map((x) => x.job.id)).toEqual([b, a]);
    expect(list[0]!.match.score).toBe(90);
  });

  it('ignores new jobs without a match', async () => {
    await upsertJobsFromSource([srcJob(1)], T1);
    expect(await getJobsForToday(0)).toEqual([]);
  });
});

describe('setStatus / matches', () => {
  it('throws for an unknown job', async () => {
    await expect(setStatus('missing', 'saved')).rejects.toThrow('המשרה לא נמצאה');
  });

  it('saveMatch overwrites by jobId', async () => {
    await saveMatch(match('j', 50));
    await saveMatch(match('j', 80));
    expect((await getMatch('j'))!.score).toBe(80);
    expect(await db.matches.count()).toBe(1);
  });
});

describe('applications and stats', () => {
  it('addApplication stores it and marks the job applied', async () => {
    const { newIds } = await upsertJobsFromSource([srcJob(1)], T1);
    await addApplication({ jobId: newIds[0]!, cvId: 'cv1', appliedAt: T1, domain: 'QA', viaReferral: false });
    expect((await db.jobs.get(newIds[0]!))!.status).toBe('applied');
    expect(await db.applications.count()).toBe(1);
  });

  it('getStats aggregates per domain, cv and week', async () => {
    const { newIds } = await upsertJobsFromSource([1, 2, 3, 4].map((n) => srcJob(n)), T1);
    const [a, b, c, d] = newIds as [string, string, string, string];
    await addApplication({ jobId: a, cvId: 'cv1', appliedAt: new Date(2026, 10, 2).toISOString(), domain: 'QA', viaReferral: false });
    await addApplication({ jobId: b, cvId: 'cv1', appliedAt: new Date(2026, 10, 4).toISOString(), domain: 'QA', viaReferral: true });
    await addApplication({ jobId: c, cvId: 'cv2', appliedAt: new Date(2026, 10, 9).toISOString(), domain: 'Backend', viaReferral: false });
    await setStatus(d, 'saved');
    const s = await getStats();
    expect(s.totalApplied).toBe(3);
    expect(s.totalSaved).toBe(1);
    expect(s.perDomain).toEqual({ QA: 2, Backend: 1 });
    expect(s.perCv).toEqual({ cv1: 2, cv2: 1 });
    expect(s.perWeek).toEqual({ '2026-11-01': 2, '2026-11-08': 1 });
    expect(Object.keys(s.perWeek)).toEqual(['2026-11-01', '2026-11-08']);
  });
});

describe('exportAll / importAll', () => {
  it('round-trips all tables including CV file blobs', async () => {
    const { newIds } = await upsertJobsFromSource([srcJob(1)], T1);
    await saveMatch(match(newIds[0]!, 77));
    const cv: CV = {
      id: 'cv1', name: 'QA', domains: ['QA'], fileName: 'cv.pdf',
      fileBlob: new Blob([new Uint8Array([37, 80, 68, 70])], { type: 'application/pdf' }),
      text: 'full', redactedText: 'redacted', versionHash: 'h', updatedAt: T1,
    };
    await db.cvs.put(cv);
    await db.contacts.put({ id: 'c1', name: 'Dana', company: 'Acme' });

    const backup = JSON.parse(JSON.stringify(await exportAll())) as unknown;
    await clearAll();
    expect(await db.jobs.count()).toBe(0);

    await importAll(backup);
    expect(await db.jobs.count()).toBe(1);
    expect((await getMatch(newIds[0]!))!.score).toBe(77);
    expect((await db.contacts.get('c1'))!.name).toBe('Dana');
    const restored = (await db.cvs.get('cv1'))!;
    expect(restored.fileBlob.type).toBe('application/pdf');
    expect([...new Uint8Array(await restored.fileBlob.arrayBuffer())]).toEqual([37, 80, 68, 70]);
  });

  it('rejects an invalid backup and leaves data untouched', async () => {
    await upsertJobsFromSource([srcJob(1)], T1);
    await expect(importAll({ format: 'something-else' })).rejects.toThrow();
    await expect(importAll('{"jobs": 5}')).rejects.toThrow();
    expect(await db.jobs.count()).toBe(1);
  });
});
