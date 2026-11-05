import { useState } from 'react';
import { addApplication, setStatus } from '@/db/repo';
import { applicationDomain } from '@/pipeline/prefilter';
import type { Application, Contact, CV, Job, JobStatus, Match } from '@/shared/types';
import { ReferralBox } from './ReferralBox';

const STATUS_DONE: Partial<Record<JobStatus, string>> = {
  saved: 'נשמרה להמשך',
  dismissed: 'סומנה כלא רלוונטית',
};

/**
 * Lifecycle buttons for one job (SPEC.md section 9.2): "הגשתי" (asks which CV was sent, default =
 * recommended), "שמירה להמשך", "לא רלוונטי". Applied and closed jobs show their state instead.
 */
export function JobActions(props: {
  job: Job;
  match?: Match;
  application?: Application;
  cvs: CV[];
  /** Contacts at this job's company (already matched by name/alias). */
  contacts?: Contact[];
  onChanged: () => void;
}) {
  const { job, match, cvs } = props;
  const contacts = props.contacts ?? [];
  const [referralId, setReferralId] = useState('');
  const [applying, setApplying] = useState(false);
  const [cvId, setCvId] = useState(match?.bestCvId ?? cvs[0]?.id ?? '');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (fn: () => Promise<void>) => {
    setBusy(true);
    setError('');
    try {
      await fn();
      props.onChanged();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const confirmApplied = () =>
    act(async () => {
      const cv = cvs.find((c) => c.id === cvId);
      await addApplication({
        jobId: job.id,
        cvId,
        appliedAt: new Date().toISOString(),
        domain: applicationDomain(job.title, cv?.domains ?? []),
        viaReferral: !!referralId,
        contactId: referralId || undefined,
      });
      setApplying(false);
    });

  if (job.status === 'applied') {
    const app = props.application;
    const cvName = app && (cvs.find((c) => c.id === app.cvId)?.name ?? 'גרסה שנמחקה');
    return (
      <div className="job__state job__state--applied">
        ✓ הוגשה{app ? ` ב-${new Date(app.appliedAt).toLocaleDateString('he-IL')}` : ''}
        {app?.viaReferral ? ' · דרך הפניה' : ''}
        {cvName ? ` · קורות חיים: ${cvName}` : ''}
      </div>
    );
  }
  if (job.status === 'closed') return <div className="job__state">המשרה כבר לא מפורסמת</div>;

  if (applying) {
    return (
      <div className="apply-form stack">
        <label className="field">
          <span className="field__label">איזו גרסת קורות חיים שלחת?</span>
          <select className="input" value={cvId} onChange={(e) => setCvId(e.target.value)} disabled={busy}>
            {cvs.length === 0 && <option value="">לא הועלו קורות חיים</option>}
            {cvs.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}{c.id === match?.bestCvId ? ' (מומלצת)' : ''}
              </option>
            ))}
          </select>
        </label>
        {contacts.length > 0 && (
          <label className="field">
            <span className="field__label">הגשת דרך הפניה?</span>
            <select className="input" value={referralId} onChange={(e) => setReferralId(e.target.value)} disabled={busy}>
              <option value="">לא, הגשה ישירה</option>
              {contacts.map((c) => <option key={c.id} value={c.id}>כן, דרך {c.name}</option>)}
            </select>
          </label>
        )}
        <div className="row wrap">
          <button className="btn btn--primary btn--small" onClick={() => void confirmApplied()} disabled={busy}>
            אישור — הגשתי
          </button>
          <button className="btn btn--ghost btn--small" onClick={() => setApplying(false)} disabled={busy}>
            ביטול
          </button>
        </div>
        {error && <div className="status status--error">{error}</div>}
      </div>
    );
  }

  return (
    <div className="stack">
      {STATUS_DONE[job.status] && <div className="job__state">{STATUS_DONE[job.status]}</div>}
      <div className="row wrap">
        <button className="btn btn--primary btn--small" onClick={() => setApplying(true)} disabled={busy}>
          הגשתי
        </button>
        {job.status !== 'saved' && (
          <button className="btn btn--small" onClick={() => void act(() => setStatus(job.id, 'saved'))} disabled={busy}>
            שמירה להמשך
          </button>
        )}
        {job.status !== 'dismissed' && (
          <button className="btn btn--ghost btn--small" onClick={() => void act(() => setStatus(job.id, 'dismissed'))} disabled={busy}>
            לא רלוונטי
          </button>
        )}
      </div>
      {error && <div className="status status--error">{error}</div>}
      {contacts.length > 0 && <ReferralBox job={job} match={match} cvs={cvs} contacts={contacts} />}
    </div>
  );
}
