// Opening an email draft (SPEC.md section 9.2): Gmail compose URL, with mailto: as the fallback.

export function gmailComposeUrl(to: string | undefined, subject: string, body: string): string {
  const q = new URLSearchParams({ view: 'cm', fs: '1', su: subject, body });
  if (to) q.set('to', to);
  return `https://mail.google.com/mail/?${q}`;
}

/** mailto: with RFC 6068 encoding (spaces as %20, not +, so mail apps show them correctly). */
export function mailtoUrl(to: string | undefined, subject: string, body: string): string {
  const enc = encodeURIComponent;
  return `mailto:${to ? enc(to) : ''}?subject=${enc(subject)}&body=${enc(body)}`;
}
