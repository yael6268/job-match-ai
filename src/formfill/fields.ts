// Form-field recognition for the form filler (SPEC.md section 11). Pure: works on plain descriptions
// of fields, so it is unit-tested without a DOM. Field names seen on real forms (2026-11-07):
// Greenhouse embed form: ids first_name, last_name, preferred_name, email, phone, resume, cover_letter;
// Lever /apply: name (full name), email, phone, location, org, urls[LinkedIn], resume (file).
import type { Profile, SourceName } from '@/shared/types';

export type ProfileKey = 'firstName' | 'lastName' | 'fullName' | 'email' | 'phone' | 'linkedin' | 'city';

/** What the content script reads off one form control. */
export interface FieldInfo {
  tag: 'input' | 'textarea' | 'select';
  type: string;
  name: string;
  id: string;
  autocomplete: string;
  ariaLabel: string;
  placeholder: string;
  label: string;
}

/** Lowercase, separators to spaces ("urls[LinkedIn]" -> "urls linkedin", "first_name" -> "first name"). */
export function norm(s: string | null | undefined): string {
  return (s ?? '')
    .toLowerCase()
    .replace(/[_\-[\].:*()/\\]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** A field whose text matches these is about someone/something else — never fill it. */
const EXCLUDE = /\b(preferred|nickname|middle|reference|referr\w*|recruiter|emergency|company|employer|school|university|manager|hiring|parent|spouse)\b|כינוי|ממליץ/;

const RULES: { key: ProfileKey; re: RegExp }[] = [
  { key: 'firstName', re: /\bfirst ?name\b|\bfname\b|\bgiven ?name\b|^first$|שם פרטי/ },
  { key: 'lastName', re: /\blast ?name\b|\blname\b|\bsurname\b|\bfamily ?name\b|^last$|שם משפחה/ },
  { key: 'fullName', re: /^name$|^full ?name$|\bfull name\b|\byour name\b|^שם$|שם מלא/ },
  { key: 'email', re: /\be ?mail\b|דוא"?ל|דואל|אימייל|מייל|דואר אלקטרוני/ },
  { key: 'linkedin', re: /linked ?in|לינקדאין|לינקדין/ },
  { key: 'phone', re: /\bphone\b|\bmobile\b|\bcell\b|^tel$|\btelephone\b|טלפון|נייד/ },
  { key: 'city', re: /^city$|\bcity\b|עיר מגורים|^עיר$|יישוב/ },
];

const AUTOCOMPLETE: Record<string, ProfileKey> = {
  'given-name': 'firstName', 'family-name': 'lastName', name: 'fullName', email: 'email', tel: 'phone',
  'tel-national': 'phone', 'address-level2': 'city',
};

function classifyText(text: string): ProfileKey | null | 'excluded' {
  const t = norm(text);
  if (!t) return null;
  if (EXCLUDE.test(t)) return 'excluded';
  return RULES.find((r) => r.re.test(t))?.key ?? null;
}

const FILLABLE_TYPES = new Set(['text', 'email', 'tel', 'url', 'search', '']);

/**
 * Which profile value belongs in this field, or null. Attributes are checked in the order the spec
 * gives — name, id, autocomplete, aria-label, placeholder, label text — and the first one that says
 * something decides (so an excluded label like "Preferred First Name" stops the search).
 */
export function classifyField(f: FieldInfo): ProfileKey | null {
  if (f.tag === 'select') return null;
  if (f.tag === 'input' && !FILLABLE_TYPES.has(f.type)) return null;
  for (const text of [f.name, f.id]) {
    const k = classifyText(text);
    if (k === 'excluded') return null;
    if (k) return k;
  }
  const ac = AUTOCOMPLETE[f.autocomplete.trim().toLowerCase()];
  if (ac) return ac;
  for (const text of [f.ariaLabel, f.placeholder, f.label]) {
    const k = classifyText(text);
    if (k === 'excluded') return null;
    if (k) return k;
  }
  if (f.type === 'email') return 'email';
  if (f.type === 'tel') return 'phone';
  return null;
}

/** The value for a key; fullName falls back to "first last". Empty string = nothing to fill. */
export function profileValue(p: Profile, key: ProfileKey): string {
  if (key === 'fullName') return (p.fullName || `${p.firstName} ${p.lastName}`).trim();
  return (p[key] ?? '').trim();
}

/** Index of the CV upload among the form's file inputs, or -1. Cover-letter inputs are never chosen. */
export function pickResumeInput(files: Pick<FieldInfo, 'name' | 'id' | 'ariaLabel' | 'label'>[]): number {
  const text = (f: (typeof files)[number]) => norm([f.name, f.id, f.ariaLabel, f.label].join(' '));
  const isCover = (t: string) => /cover|letter|מכתב/.test(t);
  const explicit = files.findIndex((f) => {
    const t = text(f);
    return !isCover(t) && /resume|\bcv\b|curriculum|קורות חיים|קו"?ח/.test(t);
  });
  if (explicit !== -1) return explicit;
  const candidates = files.map((f, i) => ({ i, t: text(f) })).filter((x) => !isCover(x.t));
  return candidates.length === 1 && files.length === 1 ? candidates[0]!.i : -1;
}

// ---------- which job is this form for ----------

export interface JobRef {
  source: SourceName;
  /** The source's job id, when the URL has it. */
  sourceJobId?: string;
  /** Otherwise a key that appears in the job's stored applyUrl (SmartRecruiters publication uuid). */
  applyUrlKey?: string;
}

/**
 * The job a form page belongs to, from its URL:
 * - Greenhouse: .../embed/job_app?for=<board>&token=<id>  or  .../<board>/jobs/<id>
 * - Lever:      jobs(.eu).lever.co/<company>/<uuid>[/apply]
 * - Comeet:     www.comeet.com/jobs/<slug>/<companyUid>/<title>/<positionUid>
 *               www.comeet.co/jobs/<companyUid>/<positionUid>/apply?... (the form's own frame)
 * - SmartRecruiters: jobs.smartrecruiters.com/oneclick-ui/company/<company>/publication/<uuid> (the form)
 *                    jobs.smartrecruiters.com/<company>/<postingId>-<slug> (the job page)
 */
export function jobRefFromUrl(raw: string): JobRef | undefined {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return undefined;
  }
  const host = u.hostname.toLowerCase();
  const parts = u.pathname.split('/').filter(Boolean);
  if (host.endsWith('greenhouse.io')) {
    const token = u.searchParams.get('token') ?? u.searchParams.get('gh_jid');
    if (token && /^\d+$/.test(token)) return { source: 'greenhouse', sourceJobId: token };
    const i = parts.indexOf('jobs');
    if (i !== -1 && /^\d+$/.test(parts[i + 1] ?? '')) return { source: 'greenhouse', sourceJobId: parts[i + 1]! };
    return undefined;
  }
  if (/^jobs(\.eu)?\.lever\.co$/.test(host)) {
    const id = parts[1];
    return id && /^[0-9a-f-]{36}$/i.test(id) ? { source: 'lever', sourceJobId: id } : undefined;
  }
  const UID = /^[0-9A-F]{2}\.[0-9A-F]{3}$/i;
  if (host === 'www.comeet.com' && parts[0] === 'jobs' && UID.test(parts[4] ?? '')) {
    return { source: 'comeet', sourceJobId: parts[4]!.toUpperCase() };
  }
  if (host === 'www.comeet.co' && parts[0] === 'jobs' && UID.test(parts[2] ?? '')) {
    return { source: 'comeet', sourceJobId: parts[2]!.toUpperCase() };
  }
  if (host === 'jobs.smartrecruiters.com') {
    const pub = parts[0] === 'oneclick-ui' ? parts[parts.indexOf('publication') + 1] : undefined;
    if (pub && /^[0-9a-f-]{36}$/i.test(pub)) return { source: 'smartrecruiters', applyUrlKey: pub.toLowerCase() };
    const id = /^(\d{6,})(?:-|$)/.exec(parts[1] ?? '')?.[1];
    if (id) return { source: 'smartrecruiters', sourceJobId: id };
  }
  return undefined;
}
