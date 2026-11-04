// Filtering and sorting for the Jobs DB screen (SPEC.md section 9.3). Pure, for testing.
import type { JobRecord } from '@/db/repo';
import type { JobStatus } from './types';

export interface JobFilter {
  status: JobStatus | 'all';
  /** Exact company name, or '' for all. */
  company: string;
  /** Score range. With the full range 0–100, jobs that were never analyzed are included too. */
  minScore: number;
  maxScore: number;
  /** Only jobs first seen in the last N days; 0 = any time. */
  days: number;
  /** Free text; every word must appear in the title, company, location, department or description. */
  query: string;
}

export const DEFAULT_FILTER: JobFilter = { status: 'all', company: '', minScore: 0, maxScore: 100, days: 0, query: '' };

export function filterJobs(records: JobRecord[], f: JobFilter, now: Date = new Date()): JobRecord[] {
  const scoreFilterOn = f.minScore > 0 || f.maxScore < 100;
  const since = f.days > 0 ? new Date(now.getTime() - f.days * 86_400_000).toISOString() : '';
  const words = f.query.toLowerCase().split(/\s+/).filter(Boolean);

  const out = records.filter(({ job, match }) => {
    if (f.status !== 'all' && job.status !== f.status) return false;
    if (f.company && job.company !== f.company) return false;
    if (scoreFilterOn && (!match || match.score < f.minScore || match.score > f.maxScore)) return false;
    if (since && job.firstSeenAt < since) return false;
    if (words.length) {
      const hay = [job.title, job.company, job.location, job.department ?? '', job.descriptionText].join('\n').toLowerCase();
      if (!words.every((w) => hay.includes(w))) return false;
    }
    return true;
  });

  // Best score first, unanalyzed last; then newest first.
  return out.sort((a, b) => {
    const sa = a.match?.score ?? -1;
    const sb = b.match?.score ?? -1;
    if (sa !== sb) return sb - sa;
    return b.job.firstSeenAt.localeCompare(a.job.firstSeenAt);
  });
}

/** Sorted, unique company names (for the company filter). */
export function companiesOf(records: JobRecord[]): string[] {
  return [...new Set(records.map((r) => r.job.company))].sort((a, b) => a.localeCompare(b));
}
