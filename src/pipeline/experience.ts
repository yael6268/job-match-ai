// Extract the required years of experience from a job description (SPEC.md section 7). No AI.
// Handles English ("3+ years", "at least 2 years", "2-4 years", "minimum of three years") and Hebrew
// ("3 שנות ניסיון", "שנות ניסיון 3", "ניסיון של 3 שנים לפחות", "שנתיים ניסיון").
// Only numbers in a requirements context (near "experience" / "ניסיון") count; the minimum is returned.

const WORD_NUMBERS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
};

/** Anything above this is not a real requirement ("founded 25 years ago" slipping through). */
const MAX_PLAUSIBLE_YEARS = 20;
const CONTEXT = /experience|\bexp\b|hands[- ]on|ניסיון|נסיון/i;

const NUM = String.raw`(\d{1,2}|${Object.keys(WORD_NUMBERS).join('|')})`;
const RANGE_TAIL = String.raw`(?:\s*\+?\s*(?:-|–|—|to)\s*\d{1,2})?`;

/** English: "<n>[+][-<m>] years|yrs". */
const EN_YEARS = new RegExp(String.raw`(?<![\w.])${NUM}\s*\+?${RANGE_TAIL}\s*\+?\s*(?:years?|yrs?)\b`, 'gi');
/** Hebrew: "<n>[+][-<m>] שנות|שנים|שנה". */
const HE_YEARS = /(?<![\d.])(\d{1,2})\s*\+?(?:\s*[-–—]\s*\d{1,2})?\s*\+?\s*(?:שנות|שנים|שנה)/g;
/** Hebrew, number after: "שנות ניסיון: 3", "שנות ניסיון 3". */
const HE_YEARS_AFTER = /שנות\s+(?:ניסיון|נסיון)\s*[:\-–]?\s*(\d{1,2})(?!\d)/g;
/** Hebrew words: "שנתיים" = 2, "שנת ניסיון" = 1. */
const HE_TWO = /שנתיים/g;
const HE_ONE = /(?:^|[^א-ת])שנת\s+(?:ניסיון|נסיון)/g;

function toNumber(raw: string): number | undefined {
  const n = /^\d+$/.test(raw) ? Number(raw) : WORD_NUMBERS[raw.toLowerCase()];
  return n !== undefined && n > 0 && n <= MAX_PLAUSIBLE_YEARS ? n : undefined;
}

/** True when the text around [start, end) talks about experience. */
function inRequirementContext(text: string, start: number, end: number): boolean {
  return CONTEXT.test(text.slice(Math.max(0, start - 50), end + 60));
}

export function extractRequiredYears(text: string): number | undefined {
  if (!text) return undefined;
  const found: number[] = [];
  const collect = (re: RegExp, value: (m: RegExpMatchArray) => number | undefined) => {
    for (const m of text.matchAll(re)) {
      const start = m.index ?? 0;
      if (!inRequirementContext(text, start, start + m[0].length)) continue;
      const n = value(m);
      if (n !== undefined) found.push(n);
    }
  };
  collect(EN_YEARS, (m) => toNumber(m[1]!));
  collect(HE_YEARS, (m) => toNumber(m[1]!));
  collect(HE_YEARS_AFTER, (m) => toNumber(m[1]!));
  collect(HE_TWO, () => 2);
  collect(HE_ONE, () => 1);
  return found.length ? Math.min(...found) : undefined;
}
