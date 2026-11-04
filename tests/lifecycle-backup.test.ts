import { describe, expect, it } from 'vitest';
import { db } from '@/db/schema';
import {
  addApplication, getJobsForToday, getStats, listAllJobs, saveMatch, setStatus, upsertJobsFromSource,
} from '@/db/repo';
import { exportBackup, importBackup, resetAllData } from '@/shared/backup';
import { getCompanies, saveCompanies } from '@/shared/companies';
import { getProfile, getSettings, saveProfile, saveSettings } from '@/shared/storage';
import type { Match, SourceJob } from '@/shared/types';
import { lastWeeks } from '@/ui/screens/StatsScreen';
import { fake } from './setup';

const T1 = '2026-11-04T08:00:00.000Z';

function srcJob(n: number): SourceJob {
  return {
    source: 'greenhouse', sourceJobId: String(n), company: 'Acme', title: `Backend Engineer ${n}`,
    url: `https://boards.greenhouse.io/acme/jobs/${n}`, location: 'Tel Aviv', descriptionText: 'C# .NET',
  };
}

function match(jobId: string, score: number): Match {
  return { jobId, score, bestCvId: 'cv1', reasons: ['r'], tips: ['t'], cvVersionHashes: 'h', model: 'm', analyzedAt: T1 };
}

describe('job lifecycle', () => {
  it('applied, saved and dismissed jobs leave Today; stats reflect applied and saved', async () => {
    const { newIds } = await upsertJobsFromSource([1, 2, 3, 4].map(srcJob), T1);
    const [a, b, c, d] = newIds as [string, string, string, string];
    for (const id of newIds) await saveMatch(match(id, 80));
    expect(await getJobsForToday(60)).toHaveLength(4);

    await addApplication({ jobId: a, cvId: 'cv1', appliedAt: T1, domain: 'Backend', viaReferral: false });
    await setStatus(b, 'saved');
    await setStatus(c, 'dismissed');
    expect((await getJobsForToday(60)).map((x) => x.job.id)).toEqual([d]);

    // A later run sees the same jobs again: statuses are kept, nothing returns to Today.
    await upsertJobsFromSource([1, 2, 3, 4].map(srcJob), '2026-11-05T08:00:00.000Z');
    expect((await getJobsForToday(60)).map((x) => x.job.id)).toEqual([d]);

    const s = await getStats();
    expect(s).toMatchObject({ totalApplied: 1, totalSaved: 1, perDomain: { Backend: 1 }, perCv: { cv1: 1 } });

    // Saved -> applied later.
    await addApplication({ jobId: b, cvId: 'cv1', appliedAt: T1, domain: 'Backend', viaReferral: false });
    expect(await getStats()).toMatchObject({ totalApplied: 2, totalSaved: 0 });

    const all = await listAllJobs();
    expect(all.find((r) => r.job.id === a)!.application).toMatchObject({ cvId: 'cv1' });
    expect(all.find((r) => r.job.id === c)!.job.status).toBe('dismissed');
  });
});

describe('backup', () => {
  async function seed() {
    const { newIds } = await upsertJobsFromSource([srcJob(1)], T1);
    await saveMatch(match(newIds[0]!, 77));
    await addApplication({ jobId: newIds[0]!, cvId: 'cv1', appliedAt: T1, domain: 'Backend', viaReferral: false });
    await saveProfile({ fullName: 'Test User', firstName: 'Test', lastName: 'User', email: 'test@example.com', phone: '000', linkedin: '', city: '' });
    await saveSettings({ geminiApiKey: 'test-key-not-real', geminiModel: 'example-flash', minScoreToShow: 55 });
    await saveCompanies([{ name: 'Acme', source: 'greenhouse', boardId: 'acme', enabled: true }]);
  }

  it('exports everything except the API key', async () => {
    await seed();
    const b = await exportBackup();
    expect(b.jobs).toHaveLength(1);
    expect(b.applications).toHaveLength(1);
    expect(b.storage.profile.firstName).toBe('Test');
    expect(b.storage.companies.map((c) => c.boardId)).toEqual(['acme']);
    expect(b.storage.settings).toMatchObject({ geminiApiKey: '', geminiModel: 'example-flash', minScoreToShow: 55 });
    expect(JSON.stringify(b)).not.toContain('test-key-not-real');
  });

  it('import restores data, profile, settings and companies, and keeps the current key', async () => {
    await seed();
    const file = JSON.stringify(await exportBackup());
    await resetAllData();
    await saveSettings({ geminiApiKey: 'other-test-key' });
    await importBackup(file);

    expect(await db.jobs.count()).toBe(1);
    expect(await db.applications.count()).toBe(1);
    expect((await getProfile()).firstName).toBe('Test');
    expect((await getCompanies()).map((c) => c.boardId)).toEqual(['acme']);
    expect(await getSettings()).toMatchObject({ geminiApiKey: 'other-test-key', minScoreToShow: 55 });
  });

  it('a broken file changes nothing', async () => {
    await seed();
    const good = await exportBackup();
    await expect(importBackup('not json')).rejects.toThrow('קובץ הגיבוי אינו תקין');
    await expect(importBackup({ ...good, storage: { ...good.storage, companies: [{ name: 'x' }] } })).rejects.toThrow('קובץ הגיבוי אינו תקין');
    await expect(importBackup({ ...good, format: 'other' })).rejects.toThrow('קובץ הגיבוי אינו תקין');
    expect(await db.jobs.count()).toBe(1);
    expect((await getCompanies()).map((c) => c.boardId)).toEqual(['acme']);
  });

  it('an older backup without the storage part still imports the database', async () => {
    await seed();
    const { storage: _storage, ...dbOnly } = await exportBackup();
    await db.jobs.clear();
    await importBackup(dbOnly);
    expect(await db.jobs.count()).toBe(1);
  });

  it('reset clears the database and chrome.storage (key included)', async () => {
    await seed();
    await resetAllData();
    expect(await db.jobs.count()).toBe(0);
    expect(await db.applications.count()).toBe(0);
    expect(await fake.storage.local.get(null)).toEqual({});
    expect((await getSettings()).geminiApiKey).toBe('');
  });
});

describe('lastWeeks', () => {
  it('returns N consecutive Sundays ending with the current week', () => {
    expect(lastWeeks(3, new Date(2026, 10, 12))).toEqual(['2026-10-25', '2026-11-01', '2026-11-08']);
  });
});
