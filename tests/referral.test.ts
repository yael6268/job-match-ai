import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateReferralEmail } from '@/ai/gemini';
import { buildReferralPrompt, cvSummary, REFERRAL_SYSTEM_INSTRUCTION } from '@/ai/prompts';
import { parseReferralOutput, referralResponseSchema } from '@/ai/schemas';
import { gmailComposeUrl, mailtoUrl } from '@/shared/mail';

const FAKE_KEY = 'test-key-not-real';
const input = {
  jobTitle: 'Senior Backend Engineer', company: 'Acme', contactName: 'Dana Example',
  userFirstName: 'Test', cvSummary: 'CV version: Backend\nDomains: Backend\nC# .NET developer, 4 years',
};
const good = { subject: 'בקשת הפניה — Senior Backend Engineer', body: 'היי דנה, ראיתי שיש אצלכם משרת Senior Backend Engineer ואשמח אם תוכלי להפנות אותי. תודה רבה!' };

afterEach(() => vi.unstubAllGlobals());

function geminiResponse(payload: unknown) {
  return { candidates: [{ content: { parts: [{ text: JSON.stringify(payload) }] } }] };
}

describe('referral prompt', () => {
  it('has the job, company, contact and sender; honesty rule in the system instruction', () => {
    const p = buildReferralPrompt(input);
    for (const s of ['Senior Backend Engineer', 'Acme', 'Dana Example', 'Sender first name: Test', '4 years']) expect(p).toContain(s);
    expect(REFERRAL_SYSTEM_INSTRUCTION).toMatch(/80-120 words/);
    expect(REFERRAL_SYSTEM_INSTRUCTION).toMatch(/Never invent experience/);
    expect(buildReferralPrompt({ ...input, userFirstName: '' })).toContain('sign without a name');
  });

  it('cvSummary uses only the redacted text, collapsed and clipped', () => {
    const s = cvSummary({ name: 'Backend', domains: ['Backend'], redactedText: 'line one\n\n line   two ' + 'x'.repeat(2000) }, 50);
    expect(s).toContain('CV version: Backend');
    expect(s).toContain('line one line two');
    expect(s).toContain('[...truncated]');
    expect(s.length).toBeLessThan(200);
  });
});

describe('parseReferralOutput', () => {
  it('accepts subject + body and rejects broken output', () => {
    expect(parseReferralOutput(good)).toEqual(good);
    expect(() => parseReferralOutput({ subject: 'x' })).toThrow('invalid referral output');
    expect(() => parseReferralOutput({ subject: '', body: good.body })).toThrow('invalid referral output');
  });
});

describe('generateReferralEmail', () => {
  it('sends structured output config with the key only in the header', async () => {
    const fetchMock = vi.fn(async (_u: string, _i?: RequestInit) => new Response(JSON.stringify(geminiResponse(good)), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    expect(await generateReferralEmail({ apiKey: FAKE_KEY, model: 'example-flash', input })).toEqual(good);
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toMatch(/\/models\/example-flash:generateContent$/);
    expect(url).not.toContain(FAKE_KEY);
    expect((init!.headers as Record<string, string>)['x-goog-api-key']).toBe(FAKE_KEY);
    const body = JSON.parse(init!.body as string);
    expect(body.generationConfig).toMatchObject({ responseMimeType: 'application/json', responseSchema: referralResponseSchema });
  });

  it('retries once on invalid output, then gives a Hebrew error', async () => {
    let n = 0;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(geminiResponse(n++ === 0 ? { subject: 'x' } : good)), { status: 200 })));
    expect(await generateReferralEmail({ apiKey: FAKE_KEY, model: 'm', input })).toEqual(good);
    expect(n).toBe(2);

    const bad = vi.fn(async () => new Response(JSON.stringify(geminiResponse({ nope: true })), { status: 200 }));
    vi.stubGlobal('fetch', bad);
    await expect(generateReferralEmail({ apiKey: FAKE_KEY, model: 'm', input })).rejects.toThrow('טיוטה');
    expect(bad).toHaveBeenCalledTimes(2);
  });

  it('needs a model', async () => {
    await expect(generateReferralEmail({ apiKey: FAKE_KEY, model: '', input })).rejects.toThrow('מודל');
  });
});

describe('mail links', () => {
  it('Gmail compose URL carries to, subject and body', () => {
    const u = new URL(gmailComposeUrl('dana@example.com', 'נושא', 'שורה 1\nשורה 2'));
    expect(u.origin + u.pathname).toBe('https://mail.google.com/mail/');
    expect(Object.fromEntries(u.searchParams)).toEqual({ view: 'cm', fs: '1', su: 'נושא', body: 'שורה 1\nשורה 2', to: 'dana@example.com' });
    expect(new URL(gmailComposeUrl(undefined, 's', 'b')).searchParams.has('to')).toBe(false);
  });

  it('mailto encodes spaces as %20 and works without a recipient', () => {
    expect(mailtoUrl('dana@example.com', 'a b', 'c&d')).toBe('mailto:dana%40example.com?subject=a%20b&body=c%26d');
    expect(mailtoUrl(undefined, 's', 'b')).toBe('mailto:?subject=s&body=b');
  });
});
