import { describe, expect, it } from 'vitest';
import type { JobRecord } from '@/db/repo';
import { companiesOf, DEFAULT_FILTER, filterJobs } from '@/shared/jobFilters';
import { applicationDomain } from '@/pipeline/prefilter';
import type { Job, JobStatus } from '@/shared/types';

const NOW = new Date('2026-11-10T12:00:00Z');

function rec(n: number, over: Partial<Job> = {}, score?: number): JobRecord {
  const job: Job = {
    id: `j${n}`, source: 'greenhouse', sourceJobId: String(n), company: 'Acme', title: `Engineer ${n}`,
    url: `https://x/${n}`, location: 'Tel Aviv', descriptionText: 'Build things with React',
    firstSeenAt: '2026-11-01T08:00:00.000Z', lastSeenAt: '2026-11-10T08:00:00.000Z', status: 'new', viewed: false,
    ...over,
  };
  const match = score === undefined ? undefined : {
    jobId: job.id, score, bestCvId: 'cv', reasons: [], tips: [], cvVersionHashes: 'h', model: 'm', analyzedAt: job.firstSeenAt,
  };
  return { job, match };
}

const ids = (r: JobRecord[]) => r.map((x) => x.job.id);

describe('filterJobs', () => {
  const all = [
    rec(1, {}, 90),
    rec(2, { status: 'applied' as JobStatus, company: 'Beta' }, 70),
    rec(3, { status: 'dismissed' as JobStatus, firstSeenAt: '2026-11-09T08:00:00.000Z' }, 40),
    rec(4, { title: 'Senior .NET Developer', descriptionText: 'C# and Azure' }),
    rec(5, { status: 'saved' as JobStatus, location: 'Haifa', firstSeenAt: '2026-11-10T09:00:00.000Z' }, 70),
  ];

  it('default filter: everything, best score first, unanalyzed last, then newest first', () => {
    expect(ids(filterJobs(all, DEFAULT_FILTER, NOW))).toEqual(['j1', 'j5', 'j2', 'j3', 'j4']);
  });

  it('by status and company', () => {
    expect(ids(filterJobs(all, { ...DEFAULT_FILTER, status: 'applied' }, NOW))).toEqual(['j2']);
    expect(ids(filterJobs(all, { ...DEFAULT_FILTER, company: 'Acme' }, NOW))).toEqual(['j1', 'j5', 'j3', 'j4']);
  });

  it('a score range drops unanalyzed jobs', () => {
    expect(ids(filterJobs(all, { ...DEFAULT_FILTER, minScore: 60, maxScore: 80 }, NOW))).toEqual(['j5', 'j2']);
    expect(ids(filterJobs(all, { ...DEFAULT_FILTER, maxScore: 99 }, NOW))).not.toContain('j4');
  });

  it('by first-seen date', () => {
    expect(ids(filterJobs(all, { ...DEFAULT_FILTER, days: 1 }, NOW))).toEqual(['j5']);
    expect(ids(filterJobs(all, { ...DEFAULT_FILTER, days: 7 }, NOW))).toEqual(['j5', 'j3']);
  });

  it('search: every word must appear, case-insensitive, in any text field', () => {
    expect(ids(filterJobs(all, { ...DEFAULT_FILTER, query: 'azure .net' }, NOW))).toEqual(['j4']);
    expect(ids(filterJobs(all, { ...DEFAULT_FILTER, query: 'haifa' }, NOW))).toEqual(['j5']);
    expect(ids(filterJobs(all, { ...DEFAULT_FILTER, query: 'react  beta' }, NOW))).toEqual(['j2']);
    expect(filterJobs(all, { ...DEFAULT_FILTER, query: 'cobol' }, NOW)).toEqual([]);
  });

  it('companiesOf lists unique sorted names', () => {
    expect(companiesOf(all)).toEqual(['Acme', 'Beta']);
  });
});

describe('applicationDomain', () => {
  it('uses the CV domain the title matches, then the CV\'s first domain, then "אחר"', () => {
    expect(applicationDomain('Senior Backend Engineer', ['Full Stack', 'Backend'])).toBe('Backend');
    expect(applicationDomain('Full Stack Developer', ['Full Stack', 'Backend'])).toBe('Full Stack');
    expect(applicationDomain('Team Lead', ['Full Stack', 'Backend'])).toBe('Full Stack');
    expect(applicationDomain('Team Lead', [])).toBe('אחר');
  });
});
