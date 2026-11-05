// Comeet (very common in Israel). A company's careers page (www.comeet.com/jobs/<slug>/<uid>) embeds
// its public careers-API credentials as `"company_uid": "49.004", "token": "<hex>"`, and its open
// positions as COMPANY_POSITIONS_DATA (seen 2026-11-04 on a real page, Upwind 49.004). Those position
// objects are the careers API's positions; tests/fixtures/comeet-upwind.json is a trimmed copy.
// The API: GET https://www.comeet.co/careers-api/2.0/company/{uid}/positions?token={token}&details=true
// returns an array of them. Description sections are in `details` (API) or `custom_fields.details` (page).
import type { Company, SourceJob } from '@/shared/types';
import { htmlToText } from '@/shared/utils';
import { fetchJson, joinUnique, mapSafely, toIso } from './http';
import type { SourceAdapter } from './types';

export interface ComeetCredentials {
  companyUid: string;
  token: string;
}

const UID = /^[0-9A-F]{2}\.[0-9A-F]{3}$/i;

/** The company uid from a careers-page URL, e.g. https://www.comeet.com/jobs/upwind/49.004 -> "49.004". */
export function comeetUidFromUrl(url: string): string | undefined {
  const m = /comeet\.com\/jobs\/[^/?#]+\/([0-9A-F]{2}\.[0-9A-F]{3})(?=[/?#]|$)/i.exec(url.trim());
  return m?.[1]?.toUpperCase();
}

/** Company uid + public token from a careers page's HTML, or undefined if the page does not have them. */
export function parseComeetCareersPage(html: string): ComeetCredentials | undefined {
  const uid = /"company_uid"\s*:\s*"([0-9A-F]{2}\.[0-9A-F]{3})"/i.exec(html);
  if (!uid) return undefined;
  // The token sits right next to the uid in the same COMPANY_DATA object.
  const near = html.slice(uid.index, uid.index + 400);
  const token = /"token"\s*:\s*"([0-9A-F]{16,64})"/i.exec(near);
  if (!token) return undefined;
  return { companyUid: uid[1]!.toUpperCase(), token: token[1]! };
}

export function isComeetUid(s: string): boolean {
  return UID.test(s.trim());
}

// ---------- positions ----------

interface ComeetDetail { name?: string; value?: string; order?: number }

interface ComeetPosition {
  uid?: string;
  name?: string;
  department?: string | null;
  location?: { name?: string | null; country?: string | null; city?: string | null } | null;
  url_comeet_hosted_page?: string | null;
  url_recruit_hosted_page?: string | null;
  url_active_page?: string | null;
  workplace_type?: string | null;
  time_updated?: string | null;
  details?: ComeetDetail[] | null;
  custom_fields?: { details?: ComeetDetail[] | null } | null;
}

export function comeetPositionsUrl(companyUid: string, token: string): string {
  const q = new URLSearchParams({ token: token.trim(), details: 'true' });
  return `https://www.comeet.co/careers-api/2.0/company/${encodeURIComponent(companyUid.trim().toUpperCase())}/positions?${q}`;
}

const regionNames = new Intl.DisplayNames(['en'], { type: 'region' });
/** "IL" -> "Israel", so the location filter (which matches names) works. */
function countryName(code: string | null | undefined): string | undefined {
  if (!code || !/^[A-Z]{2}$/i.test(code)) return undefined;
  try {
    return regionNames.of(code.toUpperCase());
  } catch {
    return undefined;
  }
}

function description(p: ComeetPosition): string {
  const sections = p.details?.length ? p.details : p.custom_fields?.details ?? [];
  return [...sections]
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
    .map((d) => ({ title: d.name?.trim() ?? '', body: htmlToText(d.value ?? '') }))
    .filter((d) => d.body)
    .map((d) => `${d.title}\n${d.body}`.trim())
    .join('\n\n');
}

/** Pure, for testing. `is_remote` is unreliable in real data (Tel Aviv jobs marked remote), so the
 *  workplace type (Hybrid / Remote / On-site) goes into the location instead. */
export function mapComeet(raw: unknown, company: Company): SourceJob[] {
  if (!Array.isArray(raw)) throw new Error('תשובה לא צפויה מ-Comeet (ציפיתי לרשימה)');
  return mapSafely(raw as ComeetPosition[], (p) => {
    const url = p.url_comeet_hosted_page || p.url_recruit_hosted_page || p.url_active_page;
    if (!p.uid || !p.name || !url) return null;
    const loc = p.location ?? {};
    return {
      source: 'comeet',
      sourceJobId: p.uid,
      company: company.name,
      title: p.name.trim(),
      url,
      // The Comeet-hosted page carries the application form (the form filler targets it).
      applyUrl: p.url_comeet_hosted_page || undefined,
      location: joinUnique([loc.name, loc.city, countryName(loc.country), p.workplace_type]),
      department: p.department?.trim() || undefined,
      descriptionText: description(p),
      postedAt: toIso(p.time_updated),
    };
  }, `comeet:${company.boardId}`);
}

export const comeet: SourceAdapter = {
  name: 'comeet',
  async fetchJobs(company) {
    if (!isComeetUid(company.boardId)) throw new Error('מזהה Comeet צריך להיראות כמו 49.004 — הדביקי את קישור עמוד הקריירה');
    if (!company.token?.trim()) throw new Error('חסר טוקן Comeet — הדביקי את קישור עמוד הקריירה בעריכת החברה');
    return mapComeet(await fetchJson(comeetPositionsUrl(company.boardId, company.token)), company);
  },
  applyUrlPatterns: ['https://www.comeet.com/jobs/*'],
};

/**
 * From a careers-page link (https://www.comeet.com/jobs/<slug>/<uid>...), fetch the page and read
 * the company uid + public token. Only comeet.com pages are fetched.
 */
export async function resolveComeetPage(link: string, timeoutMs = 20_000): Promise<ComeetCredentials> {
  let url: URL;
  try {
    url = new URL(link.trim());
  } catch {
    throw new Error('זה לא נראה כמו קישור — העתיקי את כתובת עמוד המשרות של החברה ב-Comeet');
  }
  if (url.protocol !== 'https:' || !/(^|\.)comeet\.com$/i.test(url.hostname) || !comeetUidFromUrl(url.href)) {
    throw new Error('צריך קישור בצורה https://www.comeet.com/jobs/‹חברה›/‹מזהה›');
  }
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  let html: string;
  try {
    const res = await fetch(url.href, { signal: ctrl.signal });
    if (!res.ok) throw new Error(`עמוד הקריירה החזיר שגיאה ${res.status}`);
    html = await res.text();
  } catch (e) {
    if ((e as Error).name === 'AbortError') throw new Error('עמוד הקריירה לא נטען בזמן');
    throw e instanceof Error && e.message.startsWith('עמוד') ? e : new Error('לא הצלחתי לטעון את עמוד הקריירה');
  } finally {
    clearTimeout(timer);
  }
  const creds = parseComeetCareersPage(html);
  if (!creds) throw new Error('לא נמצאו בעמוד פרטי החיבור של Comeet');
  return creds;
}
