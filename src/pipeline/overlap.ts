// Keyword-overlap scoring between a job and CVs (SPEC.md section 7, phase 3). No AI, pure.
// score = |job significant tokens ∩ CV tokens| / |job significant tokens|, best across CVs.

/** English + Hebrew stopwords, plus words every job ad uses that say nothing about fit. */
const STOPWORDS = new Set(
  `a an and are as at be been being but by can could do does for from had has have he her his how i if in into is
  it its may me might must my no not of on or our ours out over own shall she should so such than that the their
  them then there these they this those through to too under up us very was we were what when where which while
  who whom why will with would you your yours about above after again against all also any because before below
  between both during each few further here just more most only other same some until via etc e.g i.e per
  ability able across along based best build building candidate candidates company culture day degree environment
  excellent experience experienced familiarity familiar good great help highly ideal including join knowledge
  looking love new opportunity plus position preferred proven related required requirements responsibilities
  role skills strong success team teams understanding well work working world year years job apply equal
  employer within plus advantage advantages bonus etc using use used make makes like new
  של על את עם או גם כל לא כן זה זו זאת הוא היא הם הן אנחנו אתה את אני יש אין אם כי אבל רק עוד כמו בין לפי
  אצל מאוד יותר פחות כדי בתוך תוך מול אשר שלנו שלך שלכם לך לנו להם לה לו בו בה בהם הזה הזאת האלה אלה
  ניסיון יתרון דרישות דרישה תפקיד התפקיד משרה המשרה חברה החברה צוות הצוות עבודה יכולת יכולות היכרות
  שנות שנים שנה לפחות מצוינת מצוין טובה טוב גבוהה חובה ידע`
    .split(/\s+/)
    .filter(Boolean),
);

/** Single-character tokens that are real technologies. */
const SHORT_TECH = new Set(['c', 'r']);

const TOKEN = /\.?[a-z0-9א-ת][a-z0-9א-ת+#.\-]*/g;

/** Lowercase tokens, punctuation stripped, stopwords and plain numbers dropped; keeps c#, c++, .net, node.js. */
export function tokenize(text: string): Set<string> {
  const out = new Set<string>();
  for (const m of text.toLowerCase().matchAll(TOKEN)) {
    // "ב-Selenium" / "ו-Java": drop the glued Hebrew prefix letter so it matches "selenium".
    const tok = m[0].replace(/^[בהולמשכ]-/, '').replace(/[.\-]+$/, '');
    if (!tok || STOPWORDS.has(tok)) continue;
    if (/^[\d.\-+]+$/.test(tok)) continue; // numbers, versions
    if (tok.length === 1 && !SHORT_TECH.has(tok)) continue;
    out.add(tok);
  }
  return out;
}

/** Share of the job's significant tokens that also appear in the CV (0..1). */
export function overlapScore(jobTokens: Set<string>, cvTokens: Set<string>): number {
  if (jobTokens.size === 0) return 0;
  let hit = 0;
  for (const t of jobTokens) if (cvTokens.has(t)) hit++;
  return hit / jobTokens.size;
}

/** Best overlap of one job against several CVs' token sets. */
export function bestOverlap(jobText: string, cvTokenSets: Set<string>[]): number {
  const job = tokenize(jobText);
  return cvTokenSets.reduce((best, cv) => Math.max(best, overlapScore(job, cv)), 0);
}
