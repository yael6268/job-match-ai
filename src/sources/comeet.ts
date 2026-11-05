// Comeet. A company's careers page (www.comeet.com/jobs/<slug>/<uid>) embeds its public careers-API
// credentials as JSON: `"company_uid": "49.004", "token": "<hex>"` (seen 2026-11-04 on a real page).
// The positions adapter itself waits until its API response shape is verified with a real call
// (SPEC.md section 0), so Comeet is not registered in sources/index.ts yet.

export interface ComeetCredentials {
  companyUid: string;
  token: string;
}

const UID = /^[0-9A-F]{2}\.[0-9A-F]{3}$/i;

/** The company uid from a careers-page URL, e.g. https://www.comeet.com/jobs/upwind/49.004 -> "49.004". */
export function comeetUidFromUrl(url: string): string | undefined {
  const m = /comeet\.com\/jobs\/[^/?#]+\/([0-9A-F]{2}\.[0-9A-F]{3})(?=[/?#]|$)/i.exec(url.trim());
  return m?.[1]?.toUpperCase();
}

/** Company uid + public token from a careers page's HTML, or undefined if the page does not have them. */
export function parseComeetCareersPage(html: string): ComeetCredentials | undefined {
  const uid = /"company_uid"\s*:\s*"([0-9A-F]{2}\.[0-9A-F]{3})"/i.exec(html);
  if (!uid) return undefined;
  // The token sits right next to the uid in the same COMPANY_DATA object.
  const near = html.slice(uid.index, uid.index + 400);
  const token = /"token"\s*:\s*"([0-9A-F]{16,64})"/i.exec(near);
  if (!token) return undefined;
  return { companyUid: uid[1]!.toUpperCase(), token: token[1]! };
}

export function isComeetUid(s: string): boolean {
  return UID.test(s.trim());
}
