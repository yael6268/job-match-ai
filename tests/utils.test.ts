import { describe, expect, it } from 'vitest';
import {
  base64ToBlob, blobToBase64, decodeEntities, htmlToText, jobIdFromUrl, normalizeUrl, pLimit, sleep, weekStart,
} from '@/shared/utils';

describe('normalizeUrl', () => {
  it('drops tracking params, hash, www, trailing slash and forces https', () => {
    expect(normalizeUrl('http://WWW.Example.com/jobs/123/?utm_source=x&gh_src=abc#apply'))
      .toBe('https://example.com/jobs/123');
  });

  it('keeps identifying params, sorted', () => {
    expect(normalizeUrl('https://boards.greenhouse.io/wix?token=9&gh_jid=55'))
      .toBe('https://boards.greenhouse.io/wix?gh_jid=55&token=9');
  });

  it('treats lever-source variants as the same posting', () => {
    const a = normalizeUrl('https://jobs.lever.co/acme/abc-123?lever-source=LinkedIn');
    const b = normalizeUrl('https://jobs.lever.co/acme/abc-123/');
    expect(a).toBe(b);
  });

  it('is case-sensitive in the path (ids can be)', () => {
    expect(normalizeUrl('https://x.com/Jobs/AbC')).toBe('https://x.com/Jobs/AbC');
  });

  it('throws on garbage', () => {
    expect(() => normalizeUrl('not a url')).toThrow();
  });
});

describe('jobIdFromUrl', () => {
  it('is stable across equivalent URLs and a 64-char hex', async () => {
    const a = await jobIdFromUrl('https://jobs.lever.co/acme/1?utm_medium=x');
    const b = await jobIdFromUrl('http://jobs.lever.co/acme/1/');
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe('decodeEntities', () => {
  it('decodes named, decimal and hex entities', () => {
    expect(decodeEntities('a &amp; b &lt;c&gt; &#39;d&#39; &#x2013; &quot;e&quot;')).toBe('a & b <c> \'d\' – "e"');
  });
  it('leaves unknown entities alone', () => {
    expect(decodeEntities('&foo; &amp')).toBe('&foo; &amp');
  });
});

describe('htmlToText', () => {
  it('handles Greenhouse-style entity-encoded HTML', () => {
    const encoded = '&lt;p&gt;We are &lt;strong&gt;hiring&lt;/strong&gt; &amp;amp; growing&lt;/p&gt;&lt;ul&gt;&lt;li&gt;Java&lt;/li&gt;&lt;li&gt;3+ years&lt;/li&gt;&lt;/ul&gt;';
    expect(htmlToText(encoded)).toBe('We are hiring & growing\n\n• Java\n\n• 3+ years');
  });

  it('turns block tags into lines, br into newlines and strips scripts', () => {
    const html = '<div>Hello<br/>World</div><script>alert(1)</script><h2>Req</h2><p>A&nbsp;&nbsp;B</p>';
    expect(htmlToText(html)).toBe('Hello\nWorld\n\nReq\n\nA B');
  });

  it('keeps Hebrew text intact', () => {
    expect(htmlToText('<p>דרוש/ה בודק/ת תוכנה</p>')).toBe('דרוש/ה בודק/ת תוכנה');
  });

  it('returns empty string for empty input', () => {
    expect(htmlToText('')).toBe('');
  });
});

describe('pLimit', () => {
  it('never runs more than N tasks at once and preserves results', async () => {
    const limit = pLimit(2);
    let active = 0;
    let peak = 0;
    const results = await Promise.all(
      [1, 2, 3, 4, 5].map((n) =>
        limit(async () => {
          active++;
          peak = Math.max(peak, active);
          await sleep(5);
          active--;
          return n * 2;
        }),
      ),
    );
    expect(results).toEqual([2, 4, 6, 8, 10]);
    expect(peak).toBe(2);
  });

  it('keeps going after a task rejects', async () => {
    const limit = pLimit(1);
    const a = limit(() => Promise.reject(new Error('boom')));
    const b = limit(async () => 'ok');
    await expect(a).rejects.toThrow('boom');
    await expect(b).resolves.toBe('ok');
  });
});

describe('weekStart', () => {
  it('returns the Sunday of the week', () => {
    // 2026-11-04 is a Wednesday
    expect(weekStart(new Date(2026, 10, 4, 15).toISOString())).toBe('2026-11-01');
    expect(weekStart(new Date(2026, 10, 1, 0, 30).toISOString())).toBe('2026-11-01');
  });
});

describe('blob base64 round-trip', () => {
  it('preserves bytes and type', async () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 255]);
    const b64 = await blobToBase64(new Blob([bytes], { type: 'application/pdf' }));
    const back = base64ToBlob(b64, 'application/pdf');
    expect(back.type).toBe('application/pdf');
    expect([...new Uint8Array(await back.arrayBuffer())]).toEqual([...bytes]);
  });
});
