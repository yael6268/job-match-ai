// Lever Postings API. Verified 2026-11-04 against api.lever.co/v0/postings/walkme?mode=json.
// Response: array of postings. Unknown company -> 404 { ok: false }. Some companies live on api.eu.lever.co.
import type { Company, SourceJob } from '@/shared/types';
import { htmlToText } from '@/shared/utils';
import { fetchJson, HttpError, joinUnique, mapSafely, toIso } from './http';
import type { SourceAdapter } from './types';

interface LeverPosting {
  id?: string;
  text?: string;
  hostedUrl?: string;
  applyUrl?: string;
  createdAt?: number;
  country?: string;
  workplaceType?: string; // 'onsite' | 'hybrid' | 'remote' | 'unspecified'
  categories?: { location?: string; team?: string; department?: string; allLocations?: string[] };
  descriptionPlain?: string;
  lists?: { text?: string; content?: string }[];
  additionalPlain?: string;
}

export function leverUrl(boardId: string, eu = false): string {
  return `https://api${eu ? '.eu' : ''}.lever.co/v0/postings/${encodeURIComponent(boardId.trim())}?mode=json`;
}

const WORKPLACE: Record<string, string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site' };

function leverDescription(p: LeverPosting): string {
  const parts = [p.descriptionPlain?.trim() ?? ''];
  for (const list of p.lists ?? []) {
    const body = htmlToText(list.content ?? '');
    if (body) parts.push(`${list.text?.trim() ?? ''}\n${body}`.trim());
  }
  if (p.additionalPlain?.trim()) parts.push(p.additionalPlain.trim());
  return parts.filter(Boolean).join('\n\n');
}

export function mapLever(raw: unknown, company: Company): SourceJob[] {
  if (!Array.isArray(raw)) throw new Error('תשובה לא צפויה מ-Lever (ציפיתי לרשימה)');
  return mapSafely(raw as LeverPosting[], (p) => {
    if (!p.id || !p.hostedUrl || !p.text) return null;
    const cats = p.categories ?? {};
    const places = cats.allLocations?.length ? cats.allLocations : [cats.location];
    const workplace = p.workplaceType ? WORKPLACE[p.workplaceType] : undefined;
    return {
      source: 'lever',
      sourceJobId: p.id,
      company: company.name,
      title: p.text.trim(),
      url: p.hostedUrl,
      applyUrl: p.applyUrl,
      location: joinUnique([...places, p.country, workplace]),
      department: (cats.team ?? cats.department)?.trim() || undefined,
      descriptionText: leverDescription(p),
      postedAt: toIso(p.createdAt),
    };
  }, `lever:${company.boardId}`);
}

export const lever: SourceAdapter = {
  name: 'lever',
  async fetchJobs(company) {
    try {
      return mapLever(await fetchJson(leverUrl(company.boardId)), company);
    } catch (e) {
      // Not on the global instance — try the EU one before giving up.
      if (e instanceof HttpError && e.status === 404) {
        return mapLever(await fetchJson(leverUrl(company.boardId, true)), company);
      }
      throw e;
    }
  },
  applyUrlPatterns: ['https://jobs.lever.co/*', 'https://jobs.eu.lever.co/*'],
};
