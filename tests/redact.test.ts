import { describe, expect, it } from 'vitest';
import { isKeptUrl, isPhone, looksLikeAddress, redactCvText } from '@/cv/redact';
import cvEnglish from './fixtures/cv-english.txt?raw';
import cvHebrew from './fixtures/cv-hebrew.txt?raw';

// All personal details below are synthetic.

const r = redactCvText;
const has = (text: string, needle: string) => expect(r(text)).toContain(needle);
const lacks = (text: string, needle: string) => expect(r(text)).not.toContain(needle);

describe('emails', () => {
  it.each([
    'dana.tester@example.com',
    'first_last+jobs@mail.example.co.il',
    'QA.Person@Example.ORG',
  ])('removes %s', (email) => {
    const out = r(`Contact me: ${email} anytime`);
    expect(out).not.toContain(email);
    expect(out).toContain('[email]');
  });

  it('removes an email next to Hebrew text', () => {
    lacks('מייל:test.user@example.com', 'test.user@example.com');
  });
});

describe('phones — Israeli formats', () => {
  it.each([
    '050-0000000',
    '050-000-0000',
    '0500000000',
    '050 000 0000',
    '052.123.4567',
    '03-1234567',
    '(03) 123-4567',
    '077-1234567',
    '+972-50-0000000',
    '+972 50 000 0000',
    '+972500000000',
    '972-50-0000000',
    '+972 (0)50 000 0000',
  ])('removes %s', (phone) => {
    const out = r(`Phone: ${phone}, open to calls`);
    expect(out.replace(/\[phone\]/g, '')).not.toMatch(/\d{3}/);
    expect(out).toContain('[phone]');
  });

  it('removes a phone glued to Hebrew label', () => {
    expect(r('טלפון: 054-1234567 | נייד')).not.toContain('1234567');
  });
});

describe('phones — international formats', () => {
  it.each([
    '+1 (555) 123-4567',
    '+1 555 123 4567',
    '+44 20 7946 0958',
    '+49 30 12345678',
    '(555) 123-4567',
  ])('removes %s', (phone) => {
    expect(r(`Tel ${phone} ok`)).toContain('[phone]');
    expect(r(`Tel ${phone} ok`)).not.toContain(phone);
  });
});

describe('phones — things that must NOT be treated as phones', () => {
  it.each([
    'QA Engineer, Acme 2019-2023',
    'Software Engineer | 2018 – 2021',
    'Graduated 01/02/2020',
    'Graduated 01.02.2020',
    'Improved latency by 35% across 1200000 requests',
    'Node.js 18.17.1, Python 3.11',
    'B.Sc Computer Science, GPA 92',
    'IP 192.168.100.200',
    'ISTQB certificate no. 12345',
  ])('keeps: %s', (line) => {
    expect(r(line)).toBe(line);
  });

  it('removes a phone but keeps a year range on the same line', () => {
    const out = r('Acme 2019-2021 054-1234567');
    expect(out).toContain('2019-2021');
    expect(out).toContain('[phone]');
    expect(out).not.toContain('1234567');
  });

  it('isPhone classifies whole strings', () => {
    expect(isPhone('054-1234567')).toBe(true);
    expect(isPhone('+1 (555) 123-4567')).toBe(true);
    expect(isPhone('2019-2021')).toBe(false);
    expect(isPhone('12345')).toBe(false);
  });
});

describe('urls', () => {
  it('removes LinkedIn and other personal links, with or without protocol', () => {
    for (const url of [
      'https://www.linkedin.com/in/test-user-123',
      'linkedin.com/in/test-user',
      'www.facebook.com/test.user',
      'https://wa.me/972500000000',
    ]) {
      const out = r(`Profile ${url} here`);
      expect(out).not.toContain(url);
      expect(out).toContain('[link]');
    }
  });

  it('keeps GitHub, GitLab and similar work links', () => {
    for (const url of [
      'https://github.com/test-user',
      'github.com/test-user/project',
      'https://test-user.github.io',
      'https://gitlab.com/test-user',
      'https://my-app.vercel.app',
    ]) {
      has(`Code: ${url}`, url);
    }
  });

  it('keeps a link labelled as portfolio, but not a LinkedIn labelled as portfolio', () => {
    has('Portfolio: https://test-user.dev/work', 'https://test-user.dev/work');
    has('תיק עבודות: https://example.dev', 'https://example.dev');
    lacks('Portfolio: https://linkedin.com/in/x', 'linkedin.com/in/x');
  });

  it('removes unlabelled personal sites', () => {
    lacks('Site: https://test-user.dev', 'test-user.dev');
  });

  it('keeps trailing punctuation outside the placeholder', () => {
    expect(r('See https://linkedin.com/in/x.')).toBe('See [link].');
  });

  it('isKeptUrl handles subdomains and bad input', () => {
    expect(isKeptUrl('https://gist.github.com/x', '')).toBe(true);
    expect(isKeptUrl('https://notgithub.com/x', '')).toBe(false);
    expect(isKeptUrl('::::', '')).toBe(false);
  });
});

describe('addresses', () => {
  it.each([
    'Address: 12 Example Street, Tel Aviv',
    'כתובת: הרצל 12, תל אביב',
    'כתובת מגורים - רחוב הדוגמה 5 דירה 3',
    'רח\' הדוגמה 17, רמת גן',
    'רחוב הנביאים 10',
    'שדרות רוטשילד 100, תל אביב',
    'Herzl 12, Tel Aviv',
    'הרצל 12, תל אביב',
    'Example 4/2, Ramat Gan',
    '221 Baker Street',
    '1600 Pennsylvania Avenue, Washington',
    'Rothschild Blvd. 22',
    'מיקוד: 6100000',
  ])('drops the line: %s', (line) => {
    expect(looksLikeAddress(line)).toBe(true);
    expect(r(`Header\n${line}\nFooter`)).toBe('Header\nFooter');
  });

  it.each([
    'QA Engineer at Acme, Tel Aviv, 2019-2022',
    'Wix, Tel Aviv 2020',
    'Led a team of 5 testers, Herzliya',
    'Built 3 microservices in Go',
    'Tested 120 API endpoints with Postman',
    'צוות של 4 בודקים, תל אביב',
    'Military service: 8200 unit, 2015-2018',
    'Python, Java, SQL — 4 years',
  ])('keeps experience lines: %s', (line) => {
    expect(looksLikeAddress(line)).toBe(false);
    expect(r(line)).toBe(line);
  });
});

describe('ID numbers', () => {
  it('removes a labelled Israeli ID', () => {
    lacks('ת.ז. 000000018', '000000018');
    lacks('ID: 123456782', '123456782');
    lacks('תעודת זהות: 123456782', '123456782');
  });
});

describe('contact-only lines', () => {
  it('drops lines left with only placeholders and labels', () => {
    const text = 'Test User\nEmail: test@example.com | Phone: 050-0000000\nLinkedIn: linkedin.com/in/test\nQA Engineer';
    expect(r(text)).toBe('Test User\nQA Engineer');
  });

  it('keeps a line that has real content besides a placeholder', () => {
    expect(r('Reach me at test@example.com for references')).toBe('Reach me at [email] for references');
  });
});

describe('full CV fixtures', () => {
  const fixtures: Record<string, string> = { 'cv-english.txt': cvEnglish, 'cv-hebrew.txt': cvHebrew };
  const fixture = (name: string) => fixtures[name]!;

  it('English CV: no email, phone, LinkedIn or address survives; skills and dates do', () => {
    const out = r(fixture('cv-english.txt'));
    expect(out).not.toMatch(/@/);
    expect(out).not.toMatch(/0\d{1,2}[\s.-]?\d{3}[\s.-]?\d{3,4}/);
    expect(out).not.toMatch(/\+\d/);
    expect(out).not.toMatch(/linkedin/i);
    expect(out).not.toMatch(/Example Street/);
    for (const keep of ['Selenium', 'Playwright', '2019 - 2023', 'github.com/sample-user', 'B.Sc', 'Python 3.11']) {
      expect(out).toContain(keep);
    }
  });

  it('Hebrew CV: no email, phone, LinkedIn or address survives; experience does', () => {
    const out = r(fixture('cv-hebrew.txt'));
    expect(out).not.toMatch(/@/);
    expect(out).not.toMatch(/05\d[\s.-]?\d{3}[\s.-]?\d{4}/);
    expect(out).not.toMatch(/linkedin/i);
    expect(out).not.toMatch(/רחוב/);
    for (const keep of ['בודקת תוכנה', 'אוטומציה', '2020-2024', 'Jira', 'github.com/sample-user']) {
      expect(out).toContain(keep);
    }
  });

  it('is idempotent', () => {
    const once = r(fixture('cv-english.txt'));
    expect(r(once)).toBe(once);
  });
});
