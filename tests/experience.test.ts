import { describe, expect, it } from 'vitest';
import { extractRequiredYears as years } from '@/pipeline/experience';

describe('extractRequiredYears — English', () => {
  it.each([
    ['3+ years of experience in backend development', 3],
    ['At least 2 years of hands-on experience with Python', 2],
    ['2-4 years of experience as a QA engineer', 2],
    ['2 – 4 years experience', 2],
    ['Minimum of three years of experience in test automation', 3],
    ['5+ yrs experience', 5],
    ['Experience: 4+ years building web apps', 4],
    ['Requirements:\n• 1+ year of experience with Selenium', 1],
  ])('%s -> %i', (text, expected) => {
    expect(years(text)).toBe(expected);
  });

  it('returns the minimum across requirement lines', () => {
    const text = `Requirements
• 5+ years of experience in software development
• 2+ years of experience with Kubernetes`;
    expect(years(text)).toBe(2);
  });

  it('ignores year counts that are not about experience', () => {
    expect(years('We have been growing for 10 years and serve 500 customers.')).toBeUndefined();
    expect(years('Join a team that built this product over 3 years.')).toBeUndefined();
  });

  it('ignores implausible numbers and versions', () => {
    expect(years('Python 3.10 experience required')).toBeUndefined();
    expect(years('Founded 25 years ago; experience with Go is a plus')).toBeUndefined();
  });

  it('returns undefined when nothing is mentioned', () => {
    expect(years('')).toBeUndefined();
    expect(years('Strong experience with React and TypeScript')).toBeUndefined();
  });
});

describe('extractRequiredYears — Hebrew', () => {
  it.each([
    ['דרישות: 3 שנות ניסיון בפיתוח צד שרת', 3],
    ['שנות ניסיון 3 לפחות', 3],
    ['שנות ניסיון: 4', 4],
    ['ניסיון של 3 שנים לפחות בבדיקות תוכנה', 3],
    ['ניסיון של לפחות 2 שנים באוטומציה', 2],
    ['2-4 שנות ניסיון בתחום', 2],
    ['3+ שנות ניסיון ב-Java', 3],
    ['לפחות שנתיים ניסיון בבדיקות', 2],
    ['שנת ניסיון לפחות בתמיכה טכנית', 1],
  ])('%s -> %i', (text, expected) => {
    expect(years(text)).toBe(expected);
  });

  it('mixed Hebrew and English: minimum of both', () => {
    expect(years('5 שנות ניסיון בפיתוח\n2+ years of experience with AWS')).toBe(2);
  });

  it('ignores Hebrew year counts that are not about experience', () => {
    expect(years('החברה פועלת כבר 12 שנים בשוק')).toBeUndefined();
  });
});
