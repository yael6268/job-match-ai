// Greenhouse Job Board API. Verified 2026-11-04 against boards-api.greenhouse.io/v1/boards/riskified.
// Response: { jobs: [...], meta: { total } }. Unknown board -> 404. Empty board -> 200 { jobs: [] }.
import type { Company, SourceJob } from '@/shared/types';
import { htmlToText } from '@/shared/utils';
import { fetchJson, joinUnique, mapSafely, toIso } from './http';
import type { SourceAdapter } from './types';

interface GhJob {
  id?: number;
  title?: string;
  absolute_url?: string;
  content?: string; // entity-encoded HTML
  location?: { name?: string } | null;
  offices?: { name?: string; location?: string | null }[];
  departments?: { name?: string }[];
  updated_at?: string;
  first_published?: string;
}

export function greenhouseUrl(boardId: string): string {
  return `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(boardId.trim())}/jobs?content=true`;
}

export function mapGreenhouse(raw: unknown, company: Company): SourceJob[] {
  const jobs = (raw as { jobs?: unknown } | null)?.jobs;
  if (!Array.isArray(jobs)) throw new Error('תשובה לא צפויה מ-Greenhouse (חסר jobs)');
  return mapSafely(jobs as GhJob[], (j) => {
    if (j.id === undefined || !j.absolute_url || !j.title) return null;
    return {
      source: 'greenhouse',
      sourceJobId: String(j.id),
      company: company.name,
      title: j.title.trim(),
      url: j.absolute_url,
      // "Tel Aviv" + office "Tel Aviv-Yafo, Gush Dan, Israel" -> both, so country matching works.
      location: joinUnique([j.location?.name, ...(j.offices ?? []).map((o) => o.location)]),
      department: j.departments?.[0]?.name?.trim() || undefined,
      descriptionText: htmlToText(j.content ?? ''),
      postedAt: toIso(j.first_published ?? j.updated_at),
    };
  }, `greenhouse:${company.boardId}`);
}

export const greenhouse: SourceAdapter = {
  name: 'greenhouse',
  async fetchJobs(company) {
    return mapGreenhouse(await fetchJson(greenhouseUrl(company.boardId)), company);
  },
  applyUrlPatterns: ['https://boards.greenhouse.io/*', 'https://job-boards.greenhouse.io/*'],
};
