import { useState } from 'react';
import { generateReferralEmail } from '@/ai/gemini';
import { cvSummary } from '@/ai/prompts';
import { gmailComposeUrl, mailtoUrl } from '@/shared/mail';
import { getProfile, getSettings } from '@/shared/storage';
import type { Contact, CV, Job, Match } from '@/shared/types';
import { Status, type StatusMsg } from './Status';

/**
 * Shown on a job card when you know someone at the company (SPEC.md section 9.2):
 * "הגשה דרך הפניה" opens their referral link; "בקשת הפניה במייל" drafts an email with Gemini and
 * opens it in Gmail (fallback: the default mail app).
 */
export function ReferralBox(props: { job: Job; match?: Match; cvs: CV[]; contacts: Contact[] }) {
  const { job, contacts } = props;
  const [contactId, setContactId] = useState(contacts[0]?.id ?? '');
  const [draft, setDraft] = useState<{ subject: string; body: string } | null>(null);
  const [msg, setMsg] = useState<StatusMsg>(null);
  const [busy, setBusy] = useState(false);
  const contact = contacts.find((c) => c.id === contactId) ?? contacts[0];
  if (!contact) return null;

  const onDraft = async () => {
    setBusy(true);
    setMsg({ kind: 'info', text: 'כותבת טיוטה…' });
    try {
      const [settings, profile] = await Promise.all([getSettings(), getProfile()]);
      if (!settings.geminiApiKey) throw new Error('צריך מפתח Gemini (הגדרות ← Gemini)');
      const cv = props.cvs.find((c) => c.id === props.match?.bestCvId) ?? props.cvs[0];
      if (!cv) throw new Error('צריך לפחות גרסת קורות חיים אחת');
      const out = await generateReferralEmail({
        apiKey: settings.geminiApiKey,
        model: settings.geminiModel,
        input: {
          jobTitle: job.title,
          company: job.company,
          contactName: contact.name,
          userFirstName: profile.firstName,
          cvSummary: cvSummary(cv),
        },
      });
      setDraft(out);
      setMsg(profile.firstName ? null : { kind: 'info', text: 'טיפ: מלאי שם פרטי בפרטי הגשה כדי שהמייל ייחתם בשמך.' });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const open = (url: string) => window.open(url, '_blank', 'noopener');

  return (
    <div className="referral stack">
      <div className="row wrap">
        <span className="job__label grow">🤝 יש לך קשר ב-{job.company}:</span>
        {contacts.length > 1 ? (
          <select className="input" style={{ width: 'auto' }} value={contact.id} onChange={(e) => { setContactId(e.target.value); setDraft(null); }}>
            {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        ) : (
          <strong dir="auto">{contact.name}</strong>
        )}
      </div>
      <div className="row wrap">
        {contact.referralLink && (
          <button className="btn btn--small" onClick={() => open(contact.referralLink!)}>הגשה דרך הפניה</button>
        )}
        <button className="btn btn--small" onClick={() => void onDraft()} disabled={busy}>
          {draft ? 'טיוטה חדשה' : 'בקשת הפניה במייל'}
        </button>
      </div>
      <Status msg={msg} />
      {draft && (
        <div className="stack">
          <label className="field">
            <span className="field__label">נושא</span>
            <input className="input" value={draft.subject} onChange={(e) => setDraft({ ...draft, subject: e.target.value })} dir="auto" />
          </label>
          <label className="field">
            <span className="field__label">תוכן (אפשר לערוך)</span>
            <textarea className="input" rows={8} value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} dir="auto" />
          </label>
          <div className="row wrap">
            <button className="btn btn--primary btn--small" onClick={() => open(gmailComposeUrl(contact.email, draft.subject, draft.body))}>
              פתיחה ב-Gmail
            </button>
            <a className="btn btn--small" href={mailtoUrl(contact.email, draft.subject, draft.body)}>תוכנת מייל</a>
            <button className="btn btn--ghost btn--small" onClick={() => void navigator.clipboard.writeText(`${draft.subject}\n\n${draft.body}`).then(() => setMsg({ kind: 'ok', text: 'הועתק' }))}>
              העתקה
            </button>
          </div>
          {!contact.email && <span className="field__hint">לאיש הקשר אין מייל שמור — יהיה צריך למלא את הנמען.</span>}
        </div>
      )}
    </div>
  );
}
