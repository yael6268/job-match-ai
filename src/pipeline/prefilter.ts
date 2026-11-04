// Rule-based filtering of new jobs before any AI (SPEC.md section 7, phase 2). Pure functions.
import type { Domain, Job, Settings } from '@/shared/types';

/**
 * Title keywords per CV domain. Edit freely. Matching is case-insensitive and starts at a word
 * boundary ("test" matches "Tester"); a keyword ending with a space must be a whole word ("go ").
 * Hebrew keywords match anywhere (Hebrew glues prefixes like ה/ו/ב to words).
 */
export const DOMAIN_KEYWORDS: Record<Domain, string[]> = {
  QA: ['qa', 'quality', 'test', 'sdet', 'validation', 'verification', 'בודק', 'בודקת', 'בדיקות', 'בקרת איכות'],
  Automation: ['automation', 'sdet', 'אוטומציה'],
  Backend: [
    'backend', 'back-end', 'back end', 'server', 'java', 'python', 'node', '.net', 'c#', 'golang', 'go ',
    'scala', 'ruby', 'php', 'software engineer', 'software developer', 'צד שרת',
  ],
  Frontend: ['frontend', 'front-end', 'front end', 'react', 'angular', 'vue', 'ui ', 'web developer', 'צד לקוח'],
  'Full Stack': [
    'full stack', 'full-stack', 'fullstack', 'software engineer', 'software developer', 'פול סטאק', 'פולסטאק',
  ],
  DevOps: [
    'devops', 'dev ops', 'sre', 'site reliability', 'platform', 'infrastructure', 'cloud', 'kubernetes', 'דבאופס',
  ],
  Data: [
    'data', 'analyst', 'analytics', 'bi ', 'business intelligence', 'machine learning', 'ml ', 'ai ', 'etl',
    'דאטה', 'נתונים',
  ],
  Mobile: ['mobile', 'ios', 'android', 'flutter', 'react native', 'מובייל'],
  Embedded: ['embedded', 'firmware', 'fpga', 'rtos', 'hardware', 'משובץ', 'משובצות'],
  Security: ['security', 'cyber', 'appsec', 'penetration', 'soc ', 'אבטחת', 'סייבר'],
  Product: ['product manager', 'product owner', 'product analyst', 'מנהל מוצר', 'מנהלת מוצר'],
  Support: [
    'support', 'customer success', 'solutions engineer', 'technical account', 'implementation',
    'integration engineer', 'תמיכה',
  ],
};

export type PrefilterReason = 'location' | 'title' | 'excluded' | 'experience';

export interface PrefilterResult {
  passed: boolean;
  /** Why the job was dropped (first failing rule). */
  reason?: PrefilterReason;
  requiredYears?: number;
}

const HEBREW = /[א-ת]/;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** Compile one keyword into a regex following the rules in DOMAIN_KEYWORDS' comment. */
export function keywordRegex(keyword: string): RegExp {
  const k = keyword.toLowerCase();
  if (HEBREW.test(k)) return new RegExp(escape(k.trim()));
  const wholeWord = k.endsWith(' ');
  const body = escape(k.trim());
  // Keywords like ".net" / "c#" start or end with punctuation, so use explicit lookarounds.
  return new RegExp(`(?<![a-z0-9])${body}${wholeWord ? '(?![a-z0-9])' : ''}`);
}

const keywordCache = new Map<string, RegExp>();
function matchesKeyword(text: string, keyword: string): boolean {
  let re = keywordCache.get(keyword);
  if (!re) keywordCache.set(keyword, (re = keywordRegex(keyword)));
  return re.test(text);
}

/** Case-insensitive substring match against the allowed locations. An empty allow-list allows all. */
export function matchesLocation(location: string, allowed: string[]): boolean {
  const wanted = allowed.map((l) => l.trim().toLowerCase()).filter(Boolean);
  if (!wanted.length) return true;
  const loc = location.toLowerCase();
  return wanted.some((w) => loc.includes(w));
}

/** Domains (from the given set) whose keywords appear in the title. */
export function titleDomains(title: string, domains: Iterable<string>): string[] {
  const t = title.toLowerCase();
  const out: string[] = [];
  for (const d of domains) {
    const words = DOMAIN_KEYWORDS[d as Domain];
    if (words?.some((w) => matchesKeyword(t, w))) out.push(d);
  }
  return out;
}

/** True when the title contains one of the excluded words/phrases as a whole word. */
export function isExcludedTitle(title: string, excluded: string[]): boolean {
  const t = title.toLowerCase();
  return excluded
    .map((w) => w.trim().toLowerCase())
    .filter(Boolean)
    .some((w) => matchesKeyword(t, HEBREW.test(w) ? w : `${w} `));
}

/**
 * Category of an application for the stats: the first of the sent CV's domains that the job title
 * matches, else the CV's first domain, else "אחר".
 */
export function applicationDomain(title: string, cvDomains: string[]): string {
  return titleDomains(title, cvDomains)[0] ?? cvDomains[0] ?? 'אחר';
}

export interface PrefilterContext {
  settings: Pick<Settings, 'locations' | 'maxRequiredYears' | 'excludedTitleWords'>;
  /** Union of the domains of all CVs. */
  cvDomains: Iterable<string>;
}

export function prefilterJob(
  job: Pick<Job, 'title' | 'location'> & { requiredYears?: number },
  ctx: PrefilterContext,
): PrefilterResult {
  const requiredYears = job.requiredYears;
  const fail = (reason: PrefilterReason): PrefilterResult => ({ passed: false, reason, requiredYears });
  if (!matchesLocation(job.location, ctx.settings.locations)) return fail('location');
  if (isExcludedTitle(job.title, ctx.settings.excludedTitleWords)) return fail('excluded');
  if (titleDomains(job.title, ctx.cvDomains).length === 0) return fail('title');
  if (requiredYears !== undefined && requiredYears > ctx.settings.maxRequiredYears) return fail('experience');
  return { passed: true, requiredYears };
}
