// Strips personal contact details from CV text before anything is sent to the AI (SPEC.md 8.4).
// Pure functions only — heavily unit-tested in tests/redact.test.ts.

export const PLACEHOLDER = {
  email: '[email]',
  phone: '[phone]',
  url: '[link]',
  id: '[id]',
} as const;

/** Hosts whose links describe the work, not the person's contact details — kept. */
export const KEEP_URL_HOSTS = [
  'github.com', 'github.io', 'gitlab.com', 'gitlab.io', 'bitbucket.org', 'behance.net', 'dribbble.com',
  'kaggle.com', 'vercel.app', 'netlify.app', 'pages.dev', 'stackoverflow.com', 'npmjs.com', 'pypi.org',
];

/** A URL on a line with one of these words is treated as a portfolio link and kept. */
const PORTFOLIO_WORDS = /portfolio|פורטפוליו|תיק עבודות/i;

const EMAIL_RE = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/gu;

/** http(s)/www URLs and bare "domain.tld/path" links (e.g. "linkedin.com/in/x"). */
const URL_RE = /\b(?:https?:\/\/|www\.)[^\s<>()"'\]]+|\b(?:[a-z0-9-]+\.)+(?:com|net|org|io|dev|me|co\.il|co|app|ai|info)\/[^\s<>()"'\]]*/gi;

/**
 * Phone patterns, each specific enough not to swallow years, date ranges or version numbers.
 * Separators between digit groups: one space, dot, dash or en dash.
 */
const SEP = String.raw`[\s.\-–]?`;
const PHONE_RES: RegExp[] = [
  // +972 54-123-4567, +1 (555) 123-4567, +44 20 7946 0958
  new RegExp(String.raw`\+\d{1,3}${SEP}\(?\d{1,4}\)?(?:${SEP}\d{2,4}){2,4}(?!\d)`, 'g'),
  // 972-54-1234567 (country code without +)
  new RegExp(String.raw`(?<!\d)972${SEP}\(?0?\d{1,2}\)?${SEP}\d{3}${SEP}\d{3,4}(?!\d)`, 'g'),
  // Israeli local: 054-1234567, 054-123-4567, 0541234567, 03-1234567, (03) 123-4567, 077 123 4567
  new RegExp(String.raw`(?<![\d.])\(?0\d{1,2}\)?${SEP}\d{3}${SEP}\d{3,4}(?![\d.]\d)`, 'g'),
  // US style without +: (555) 123-4567
  new RegExp(String.raw`\(\d{3}\)${SEP}\d{3}${SEP}\d{4}(?!\d)`, 'g'),
];

/** True if the whole string is a phone number by one of the patterns (digit count 9–15). */
export function isPhone(s: string): boolean {
  const t = s.trim();
  const digits = t.replace(/\D/g, '').length;
  if (digits < 9 || digits > 15) return false;
  return PHONE_RES.some((re) => new RegExp(`^(?:${re.source})$`).test(t));
}

function redactPhones(line: string): string {
  let out = line;
  for (const re of PHONE_RES) {
    out = out.replace(re, (m) => {
      const digits = m.replace(/\D/g, '').length;
      return digits >= 9 && digits <= 15 ? PLACEHOLDER.phone : m;
    });
  }
  return out;
}

// Israeli ID number with a label: "ת.ז. 123456789", "ID: 123456789".
const ID_RE = /(ת\.?\s?ז\.?|תעודת זהות|\bID(?: number)?\b)\s*:?\s*\d{8,9}\b/giu;

// ---- addresses ----

const ADDRESS_LABEL_RE = /^\s*(address|home address|כתובת(?: מגורים)?|מען)\s*[:\-–]/i;

const HEBREW_STREET_RE = /(^|[\s,|•·])(רח(?:וב|')|שד(?:רות|')|סמטת|דרך|שכונת)\s+[\p{L}"'׳״\- ]{2,30}\s*\d{1,4}/u;

const ENGLISH_STREET_RE =
  /\b\d{1,5}\s+(?:[A-Z][\p{L}'-]*\s+){1,4}(street|st\.?|avenue|ave\.?|road|rd\.?|boulevard|blvd\.?|lane|ln\.?|drive|dr\.?|way|court|ct\.?|place|pl\.?)(?=[\s,.]|$)/iu;

const ENGLISH_STREET_NAME_FIRST_RE =
  /\b[A-Z][\p{L}'-]+(?:\s+[A-Z][\p{L}'-]+){0,3}\s+([Ss]treet|[Ss]t\.|[Aa]venue|[Aa]ve\.|[Rr]oad|[Rr]d\.|[Bb]oulevard|[Bb]lvd\.)\s+\d{1,4}\b/u;

/** "Herzl 12, Tel Aviv" / "הרצל 12, רמת גן": a word, a house number, a comma, a known city. */
const ISRAELI_CITIES = [
  'tel aviv', 'tel-aviv', 'jerusalem', 'haifa', 'ramat gan', 'givatayim', 'herzliya', 'raanana', "ra'anana",
  'petah tikva', 'petach tikva', 'holon', 'bat yam', 'rishon lezion', 'rishon le zion', 'rehovot', 'netanya',
  'kfar saba', 'hod hasharon', 'modiin', "modi'in", 'beer sheva', "be'er sheva", 'ashdod', 'ashkelon',
  'yokneam', 'caesarea', 'rosh haayin', 'or yehuda', 'yavne', 'nes ziona', 'kiryat ono', 'bnei brak',
  'תל אביב', 'ת"א', 'ירושלים', 'חיפה', 'רמת גן', 'גבעתיים', 'הרצליה', 'רעננה', 'פתח תקווה', 'פתח תקוה',
  'חולון', 'בת ים', 'ראשון לציון', 'רחובות', 'נתניה', 'כפר סבא', 'הוד השרון', 'מודיעין', 'באר שבע',
  'אשדוד', 'אשקלון', 'יקנעם', 'קיסריה', 'ראש העין', 'אור יהודה', 'יבנה', 'נס ציונה', 'קריית אונו',
  'קרית אונו', 'בני ברק',
];

const STREET_NUMBER_CITY_RE = new RegExp(
  String.raw`[\p{L}"'׳״\-]{2,}(?:\s+[\p{L}"'׳״\-]{2,}){0,2}\s+(?!(?:19|20)\d{2}\b)\d{1,4}[א-ת]?\s*(?:/\s*\d{1,3}\s*)?,\s*(?:${ISRAELI_CITIES.map(escapeRe).join('|')})`,
  'iu',
);

// No \b before the label: JS \b does not treat Hebrew letters as word characters.
const ZIP_RE = /(?:^|[\s,|])(zip|postal code|מיקוד)\s*:?\s*\d{5,7}(?!\d)/i;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** True for a line that is (or contains) a street address. Kept short to avoid eating experience lines. */
export function looksLikeAddress(line: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (ADDRESS_LABEL_RE.test(t)) return true;
  if (t.length > 120) return false;
  return (
    HEBREW_STREET_RE.test(t) ||
    ENGLISH_STREET_RE.test(t) ||
    ENGLISH_STREET_NAME_FIRST_RE.test(t) ||
    STREET_NUMBER_CITY_RE.test(t) ||
    ZIP_RE.test(t)
  );
}

function hostOf(url: string): string | null {
  try {
    const withProto = /^https?:\/\//i.test(url) ? url : `https://${url}`;
    return new URL(withProto).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return null;
  }
}

export function isKeptUrl(url: string, line: string): boolean {
  const host = hostOf(url);
  if (!host) return false;
  if (KEEP_URL_HOSTS.some((h) => host === h || host.endsWith(`.${h}`))) return true;
  // A portfolio link is kept, unless it is a social/contact profile.
  if (PORTFOLIO_WORDS.test(line) && !/linkedin|facebook|instagram|twitter|x\.com|wa\.me|t\.me/.test(host)) return true;
  return false;
}

function redactLine(line: string): string {
  let out = line.replace(EMAIL_RE, PLACEHOLDER.email);
  out = out.replace(URL_RE, (url) => {
    const trimmed = url.replace(/[.,;:!?]+$/, '');
    const tail = url.slice(trimmed.length);
    return isKeptUrl(trimmed, line) ? url : PLACEHOLDER.url + tail;
  });
  out = out.replace(ID_RE, PLACEHOLDER.id);
  return redactPhones(out);
}

/** Collapses lines that held only removed contact details ("[email] | [phone]") so the AI sees less noise. */
function isOnlyPlaceholders(line: string): boolean {
  const rest = line
    .replace(/\[(email|phone|link|id)\]/g, '')
    .replace(/(e-?mail|phone|mobile|tel|cell|linkedin|טלפון|נייד|טל'?|דוא"ל|מייל|אימייל|לינקדאין)\s*:?/gi, '')
    .replace(/[\s|•·,;:/\\\-–]+/g, '');
  return line.includes('[') && rest.length === 0;
}

export function redactCvText(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n');
  const kept: string[] = [];
  for (const line of lines) {
    if (looksLikeAddress(line)) continue;
    const red = redactLine(line);
    if (isOnlyPlaceholders(red)) continue;
    kept.push(red);
  }
  return kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}
