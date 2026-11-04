import { describe, expect, it, vi } from 'vitest';
import docxDataUrl from './fixtures/sample-cv.docx?inline';
import pdfDataUrl from './fixtures/sample-cv.pdf?inline';
import { base64ToBlob } from '@/shared/utils';
import { detectKind, extractCvText, normalizeExtractedText, pdfItemsToText } from '@/cv/extract';

// In Node, pdfjs loads its worker module from a file URL instead of the bundled asset URL.
vi.mock('@/cv/pdf-worker-url', () => ({
  default: new URL('../node_modules/pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url).href,
}));

/** Vite `?inline` gives a base64 data URL; turn it back into a Blob. */
const fromDataUrl = (dataUrl: string, type: string) => base64ToBlob(dataUrl.split(',')[1] ?? '', type);

describe('detectKind', () => {
  it('uses MIME type or extension', () => {
    expect(detectKind('cv.PDF', '')).toBe('pdf');
    expect(detectKind('x', 'application/pdf')).toBe('pdf');
    expect(detectKind('cv.docx', '')).toBe('docx');
    expect(detectKind('cv.doc', 'application/msword')).toBeNull();
    expect(detectKind('cv.txt', 'text/plain')).toBeNull();
  });
});

describe('pdfItemsToText', () => {
  const at = (str: string, y: number, hasEOL = false) => ({ str, transform: [1, 0, 0, 1, 0, y], height: 10, hasEOL });

  it('breaks lines on EOL and baseline changes, pages on blank lines', () => {
    const text = pdfItemsToText([
      [at('QA', 700), at(' ', 700), at('Engineer', 700, true), at('Selenium,', 680), at(' Python', 680)],
      [at('Page two', 700)],
    ]);
    expect(text).toBe('QA Engineer\nSelenium, Python\n\nPage two');
  });

  it('keeps Hebrew items in content order', () => {
    expect(pdfItemsToText([[at('בודקת', 700), at(' ', 700), at('תוכנה', 700)]])).toBe('בודקת תוכנה');
  });
});

describe('normalizeExtractedText', () => {
  it('removes bidi marks and zero-width chars, collapses whitespace', () => {
    expect(normalizeExtractedText('‏שלום‎  world\r\n\r\n\r\n\tend﻿')).toBe('שלום world\n\nend');
  });
});

describe('extractCvText', () => {
  it('extracts English and Hebrew text from a DOCX', async () => {
    const text = await extractCvText(
      fromDataUrl(docxDataUrl, 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'),
      'sample-cv.docx',
    );
    expect(text).toContain('QA Automation at Acme, 2019-2023');
    expect(text).toContain('בודקת תוכנה עם ניסיון באוטומציה');
    expect(text.split('\n').filter(Boolean)).toHaveLength(4);
  });

  it('extracts text from a PDF', async () => {
    const text = await extractCvText(fromDataUrl(pdfDataUrl, 'application/pdf'), 'sample-cv.pdf');
    expect(text).toContain('Sample User - QA Engineer');
    expect(text).toContain('Selenium, Python, Jira');
  });

  it('rejects unsupported types and garbage files with Hebrew messages', async () => {
    await expect(extractCvText(new Blob(['x']), 'cv.txt')).rejects.toThrow('סוג קובץ לא נתמך');
    await expect(extractCvText(new Blob(['not a pdf']), 'cv.pdf')).rejects.toThrow('PDF');
    await expect(extractCvText(new Blob(['not a zip']), 'cv.docx')).rejects.toThrow('Word');
  });

  it('rejects files that are too large', async () => {
    const big = new Blob([new Uint8Array(10 * 1024 * 1024 + 1)], { type: 'application/pdf' });
    await expect(extractCvText(big, 'cv.pdf')).rejects.toThrow('גדול מדי');
  });
});
