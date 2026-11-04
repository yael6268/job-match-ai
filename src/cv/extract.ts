// CV file -> plain text. PDF via pdfjs-dist (worker bundled locally), DOCX via mammoth.
// Heavy libraries are loaded lazily so the side panel opens fast.

export type CvFileKind = 'pdf' | 'docx';

export const ACCEPTED_CV_TYPES = '.pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document';

export const MAX_CV_BYTES = 10 * 1024 * 1024;

export function detectKind(fileName: string, mime: string): CvFileKind | null {
  const name = fileName.toLowerCase();
  if (mime === 'application/pdf' || name.endsWith('.pdf')) return 'pdf';
  if (mime === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' || name.endsWith('.docx')) {
    return 'docx';
  }
  return null;
}

/** Minimal shape of a pdfjs TextItem that we use. */
export interface PdfTextItem {
  str: string;
  hasEOL?: boolean;
  /** [a, b, c, d, x, y] */
  transform?: number[];
  height?: number;
}

/**
 * Joins pdfjs text items into lines. Keeps content-stream order (which is logical order for
 * Hebrew in most generated PDFs) and starts a new line when an item says so or the baseline moves.
 */
export function pdfItemsToText(pages: PdfTextItem[][]): string {
  const pageTexts = pages.map((items) => {
    let out = '';
    let lastY: number | undefined;
    for (const item of items) {
      const y = item.transform?.[5];
      const lineHeight = Math.max(item.height ?? 0, 2);
      if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > lineHeight * 0.5 && !out.endsWith('\n')) {
        out += '\n';
      }
      // pdfjs emits inter-word spaces as their own items, so items are concatenated as-is.
      out += item.str;
      if (item.hasEOL) out += '\n';
      if (y !== undefined) lastY = y;
    }
    return out;
  });
  return normalizeExtractedText(pageTexts.join('\n\n'));
}

/** Common cleanup: unify newlines, trim lines, collapse blank runs, drop zero-width chars. */
export function normalizeExtractedText(text: string): string {
  return text
    .replace(/\r\n?/g, '\n')
    .replace(/[​‎‏‪-‮﻿]/g, '')
    .replace(/ /g, ' ')
    .split('\n')
    .map((l) => l.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

async function extractPdf(data: ArrayBuffer): Promise<string> {
  const pdfjs = await import('pdfjs-dist');
  const { default: workerUrl } = await import('./pdf-worker-url');
  pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;
  const task = pdfjs.getDocument({
    data: new Uint8Array(data),
    // Bundled with the extension (see wxt.config.ts) — no CDN.
    cMapUrl: browserAssetUrl('pdfjs/cmaps/'),
    cMapPacked: true,
  });
  const doc = await task.promise;
  try {
    const pages: PdfTextItem[][] = [];
    for (let i = 1; i <= doc.numPages; i++) {
      const page = await doc.getPage(i);
      const content = await page.getTextContent();
      const items: PdfTextItem[] = [];
      for (const it of content.items) if ('str' in it) items.push(it);
      pages.push(items);
    }
    return pdfItemsToText(pages);
  } finally {
    await task.destroy();
  }
}

function browserAssetUrl(path: string): string {
  // chrome.runtime.getURL in the extension; relative URL elsewhere (static preview).
  const runtime = (globalThis as { chrome?: { runtime?: { getURL?: (p: string) => string } } }).chrome?.runtime;
  return runtime?.getURL ? runtime.getURL(path) : `/${path}`;
}

async function extractDocx(data: ArrayBuffer): Promise<string> {
  const mammoth = await import('mammoth');
  // mammoth's browser build takes an ArrayBuffer; its Node build (used by tests) needs a Buffer.
  const NodeBuffer = (globalThis as { Buffer?: { from(d: ArrayBuffer): Uint8Array } }).Buffer;
  const input = NodeBuffer ? { buffer: NodeBuffer.from(data) as never } : { arrayBuffer: data };
  const result = await mammoth.extractRawText(input);
  return normalizeExtractedText(result.value);
}

/** Extracts plain text from a CV file. Throws a Hebrew, user-facing Error on failure. */
export async function extractCvText(file: Blob, fileName: string): Promise<string> {
  const kind = detectKind(fileName, file.type);
  if (!kind) throw new Error('סוג קובץ לא נתמך — יש להעלות PDF או DOCX');
  if (file.size > MAX_CV_BYTES) throw new Error('הקובץ גדול מדי (מקסימום 10MB)');
  const data = await file.arrayBuffer();
  let text: string;
  try {
    text = kind === 'pdf' ? await extractPdf(data) : await extractDocx(data);
  } catch (e) {
    console.error('CV extraction failed', e);
    throw new Error(kind === 'pdf' ? 'לא הצלחתי לקרוא את קובץ ה-PDF' : 'לא הצלחתי לקרוא את קובץ ה-Word');
  }
  if (text.replace(/\s/g, '').length < 30) {
    throw new Error('לא נמצא טקסט בקובץ. אם זה PDF סרוק (תמונה), יש לשמור אותו מחדש כ-PDF עם טקסט או כ-DOCX');
  }
  return text;
}
