// SmartRecruiters Posting API. Verified 2026-11-04 against
// api.smartrecruiters.com/v1/companies/CheckPointSoftwareTechnologies2/postings.
// List: { offset, limit, totalFound, content: [...] } (no description), paginated with limit/offset,
// filterable with country=<iso, lowercase>. Details per posting: GET .../postings/{id} with
// jobAd.sections.{jobDescription,qualifications,additionalInformation}.text as HTML, plus postingUrl/applyUrl.
import type { Company, SourceJob } from '@/shared/types';
import { htmlToText, pLimit } from '@/shared/utils';
import { fetchJson, joinUnique, mapSafely, toIso } from './http';
import type { SourceAdapter } from './types';

const API = 'https://api.smartrecruiters.com/v1/companies';
const PAGE_SIZE = 100;
const MAX_PAGES = 20;
/** Details are one call per posting; keep a run bounded even for huge boards. */
export const MAX_DETAILS = 200;
const DETAIL_CONCURRENCY = 4;

interface SrLocation {
  city?: string;
  country?: string;
  remote?: boolean;
  hybrid?: boolean;
  fullLocation?: string;
}

interface SrPosting {
  id?: string;
  /** Publication uuid: the Easy-apply form lives at /oneclick-ui/company/<company>/publication/<uuid>. */
  uuid?: string;
  name?: string;
  releasedDate?: string;
  location?: SrLocation;
  department?: { label?: string };
  function?: { label?: string };
}

interface SrSection { title?: string; text?: string }

interface SrDetail extends SrPosting {
  postingUrl?: string;
  applyUrl?: string;
  jobAd?: { sections?: Record<string, SrSection | undefined> };
}

export function smartRecruitersListUrl(boardId: string, offset: number, country?: string): string {
  const q = new URLSearchParams({ limit: String(PAGE_SIZE), offset: String(offset) });
  if (country) q.set('country', country.toLowerCase());
  return `${API}/${encodeURIComponent(boardId.trim())}/postings?${q}`;
}

export function smartRecruitersDetailUrl(boardId: string, postingId: string): string {
  return `${API}/${encodeURIComponent(boardId.trim())}/postings/${encodeURIComponent(postingId)}`;
}

/** Postings of one list page. Throws on an unexpected shape. */
export function parseList(raw: unknown): { items: SrPosting[]; total: number } {
  const r = raw as { content?: unknown; totalFound?: unknown } | null;
  if (!Array.isArray(r?.content)) throw new Error('תשובה לא צפויה מ-SmartRecruiters (חסר content)');
  return { items: r.content as SrPosting[], total: typeof r.totalFound === 'number' ? r.totalFound : r.content.length };
}

/** The job-specific sections as plain text (the company blurb is the same for every job, so it is left out). */
function description(d: SrDetail): string {
  const s = d.jobAd?.sections ?? {};
  return ['jobDescription', 'qualifications', 'additionalInformation']
    .map((k) => s[k])
    .filter((x): x is SrSection => !!x && !!htmlToText(x.text ?? ''))
    .map((x) => `${x.title?.trim() ?? ''}\n${htmlToText(x.text ?? '')}`.trim())
    .join('\n\n');
}

/** One posting (list item merged with its details) in the common shape. Pure, for testing. */
export function mapSmartRecruiters(item: SrPosting, detail: SrDetail | undefined, company: Company): SourceJob | null {
  const d: SrDetail = { ...item, ...detail };
  if (!d.id || !d.name) return null;
  const loc = d.location ?? {};
  return {
    source: 'smartrecruiters',
    sourceJobId: d.id,
    company: company.name,
    title: d.name.trim(),
    url: d.postingUrl || `https://jobs.smartrecruiters.com/${encodeURIComponent(company.boardId.trim())}/${d.id}`,
    // The Easy-apply form itself (verified 2026-11-07): ?oga=true links redirect there, and the form
    // filler identifies the job by this uuid.
    applyUrl: d.uuid
      ? `https://jobs.smartrecruiters.com/oneclick-ui/company/${encodeURIComponent(company.boardId.trim())}/publication/${d.uuid}`
      : d.applyUrl || undefined,
    location: joinUnique([loc.fullLocation ?? loc.city, loc.remote ? 'Remote' : undefined, loc.hybrid ? 'Hybrid' : undefined]),
    department: (d.department?.label ?? d.function?.label)?.trim() || undefined,
    descriptionText: description(d),
    postedAt: toIso(d.releasedDate),
  };
}

export const smartrecruiters: SourceAdapter = {
  name: 'smartrecruiters',
  async fetchJobs(company) {
    // 1. All pages of the (optionally country-filtered) list.
    const items: SrPosting[] = [];
    for (let page = 0; page < MAX_PAGES; page++) {
      const { items: batch, total } = parseList(await fetchJson(smartRecruitersListUrl(company.boardId, items.length, company.country)));
      items.push(...batch);
      if (batch.length === 0 || items.length >= total) break;
    }
    // 2. Details per posting, a few at a time. A failed detail keeps the job with an empty description.
    const wanted = items.filter((i) => i.id).slice(0, MAX_DETAILS);
    if (items.length > MAX_DETAILS) {
      console.warn(`[smartrecruiters:${company.boardId}] ${items.length} postings, details for the first ${MAX_DETAILS}`);
    }
    const limit = pLimit(DETAIL_CONCURRENCY);
    const details = await Promise.all(
      wanted.map((i) =>
        limit(async () => {
          try {
            return (await fetchJson(smartRecruitersDetailUrl(company.boardId, i.id!))) as SrDetail;
          } catch (e) {
            console.warn(`[smartrecruiters:${company.boardId}] details failed for ${i.id}`, e);
            return undefined;
          }
        }),
      ),
    );
    return mapSafely(wanted.map((item, k) => ({ item, detail: details[k] })), ({ item, detail }) =>
      mapSmartRecruiters(item, detail, company), `smartrecruiters:${company.boardId}`);
  },
  applyUrlPatterns: ['https://jobs.smartrecruiters.com/*'],
};
