import { describe, expect, it } from 'vitest';
import { bestOverlap, overlapScore, tokenize } from '@/pipeline/overlap';
// Fictional CV fixtures from M2 (no real personal data).
import cvEn from './fixtures/cv-english.txt?raw';
import cvHe from './fixtures/cv-hebrew.txt?raw';

describe('tokenize', () => {
  it('keeps tech tokens with punctuation', () => {
    const t = tokenize('Experience with C#, C++, .NET, Node.js, CI/CD and REST APIs.');
    for (const tok of ['c#', 'c++', '.net', 'node.js', 'ci', 'cd', 'rest', 'apis']) expect(t).toContain(tok);
  });

  it('drops stopwords (English + Hebrew), numbers and stray letters', () => {
    const t = tokenize('We are looking for a strong team player with 3+ years of experience. של עם ניסיון 2024 x');
    expect([...t]).toEqual(['player']);
  });

  it('strips trailing punctuation but keeps inner dots', () => {
    expect([...tokenize('Python. Selenium- node.js.')]).toEqual(['python', 'selenium', 'node.js']);
  });

  it('keeps Hebrew words and drops a glued Hebrew prefix before Latin words', () => {
    expect(tokenize('בדיקות אוטומציה ב-Selenium ו-Java')).toEqual(new Set(['בדיקות', 'אוטומציה', 'selenium', 'java']));
  });
});

describe('overlapScore', () => {
  it('is the share of job tokens found in the CV', () => {
    expect(overlapScore(new Set(['a1', 'b1', 'c1', 'd1']), new Set(['a1', 'b1', 'z']))).toBe(0.5);
    expect(overlapScore(new Set(), new Set(['a1']))).toBe(0);
  });
});

describe('bestOverlap with realistic texts', () => {
  const qaJob = `QA Automation Engineer
We are looking for a QA Automation Engineer to join our team.
Requirements:
• 2+ years of experience in test automation using Selenium or Playwright
• Strong Python or Java skills
• Experience with CI/CD (Jenkins, GitHub Actions)
• Knowledge of SQL and REST API testing (Postman)`;

  const salesJob = `Account Executive
Own the full sales cycle with enterprise customers, negotiate contracts, exceed quota,
build pipeline with marketing and partner with customer success.`;

  it('a QA job scores higher than a sales job against the same CVs', () => {
    const cvs = [tokenize(cvEn), tokenize(cvHe)];
    const qa = bestOverlap(qaJob, cvs);
    const sales = bestOverlap(salesJob, cvs);
    expect(qa).toBeGreaterThan(sales);
    expect(qa).toBeGreaterThan(0);
    expect(qa).toBeLessThanOrEqual(1);
  });

  it('takes the best CV', () => {
    const qaCv = tokenize('selenium playwright python jenkins sql postman automation');
    const salesCv = tokenize('sales quota pipeline negotiate');
    expect(bestOverlap(qaJob, [salesCv, qaCv])).toBe(bestOverlap(qaJob, [qaCv]));
  });

  it('no CVs means 0', () => {
    expect(bestOverlap(qaJob, [])).toBe(0);
  });
});
