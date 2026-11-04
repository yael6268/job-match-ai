// Small, pure helpers. Must not depend on Chrome APIs so they stay unit-testable.

/** Query params that only track where a click came from and never identify the job. */
const TRACKING_PARAMS = new Set([
  'gh_src', 'gh_jid_src', 'lever-source', 'lever-origin', 'source', 'src', 'ref', 'referrer',
  'fbclid', 'gclid', 'mc_cid', 'mc_eid', 'trk', 'trackingid',
]);

/**
 * Canonical form of a job URL, so the same posting always hashes to the same id:
 * https, lowercase host, no "www.", no port, no hash, no tracking params, sorted params,
 * no trailing slash on the path.
 */
export function normalizeUrl(raw: string): string {
  const url = new URL(raw.trim());
  const host = url.hostname.toLowerCase().replace(/^www\./, '');
  const path = url.pathname.replace(/\/+$/, '');
  const kept = [...url.searchParams.entries()]
    .filter(([k]) => {
      const key = k.toLowerCase();
      return !key.startsWith('utm_') && !TRACKING_PARAMS.has(key);
    })
    .sort(([a, av], [b, bv]) => a.localeCompare(b) || av.localeCompare(bv));
  const query = new URLSearchParams(kept).toString();
  return `https://${host}${path}${query ? `?${query}` : ''}`;
}

/** Hex SHA-256 via Web Crypto (available in extension pages, service workers and Node 20+). */
export async function sha256(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Stable job id: sha256 of the normalized public URL. */
export function jobIdFromUrl(url: string): Promise<string> {
  return sha256(normalizeUrl(url));
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function uuid(): string {
  return crypto.randomUUID();
}

/** Local date as YYYY-MM-DD (used for the daily AI-call counter). */
export function localDateStr(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '–', mdash: '—',
  hellip: '…', rsquo: '’', lsquo: '‘', rdquo: '”', ldquo: '“', bull: '•', middot: '·',
  copy: '©', reg: '®', trade: '™', shy: '',
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, ent: string) => {
    if (ent.startsWith('#')) {
      const hex = ent[1] === 'x' || ent[1] === 'X';
      const code = hex ? parseInt(ent.slice(2), 16) : parseInt(ent.slice(1), 10);
      return Number.isFinite(code) && code <= 0x10ffff ? String.fromCodePoint(code) : m;
    }
    return NAMED_ENTITIES[ent.toLowerCase()] ?? m;
  });
}

/**
 * HTML -> readable plain text. Handles entity-encoded HTML (Greenhouse sends `&lt;p&gt;`),
 * keeps line breaks for block elements and bullets for list items. No DOM needed.
 */
export function htmlToText(html: string): string {
  let s = html;
  // Greenhouse entity-encodes the markup itself: decode once so the tags become real tags.
  if (/&lt;\/?[a-z]/i.test(s)) s = decodeEntities(s);
  s = s
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/(script|style)>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '\n• ')
    .replace(/<\/(p|div|h[1-6]|li|ul|ol|tr|section|article|header|footer)>/gi, '\n')
    .replace(/<(p|div|h[1-6]|ul|ol|tr|section|article)(\s[^>]*)?>/gi, '\n')
    .replace(/<[^>]+>/g, '');
  s = decodeEntities(s);
  return s
    .replace(/ /g, ' ')
    .split('\n')
    .map((line) => line.replace(/[ \t]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Minimal p-limit: run at most `concurrency` async tasks at once. */
export function pLimit(concurrency: number) {
  let active = 0;
  const queue: (() => void)[] = [];
  const next = () => {
    active--;
    queue.shift()?.();
  };
  return function limit<T>(task: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      const run = () => {
        active++;
        task().then(resolve, reject).finally(next);
      };
      if (active < concurrency) run();
      else queue.push(run);
    });
  };
}

/** Start of the week (Sunday, Israeli convention) as YYYY-MM-DD, for weekly stats. */
export function weekStart(iso: string): string {
  const d = new Date(iso);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - d.getDay());
  return localDateStr(d);
}

export async function blobToBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let bin = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    bin += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(bin);
}

export function base64ToBlob(b64: string, type: string): Blob {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new Blob([bytes], { type });
}
