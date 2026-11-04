import { useCallback, useEffect, useMemo, useState } from 'react';
import { listAllJobs, listCvs, type JobRecord } from '@/db/repo';
import { companiesOf, DEFAULT_FILTER, filterJobs, type JobFilter } from '@/shared/jobFilters';
import type { CV, JobStatus } from '@/shared/types';
import { EmptyState } from '../components/EmptyState';
import { JobActions } from '../components/JobActions';
import { JobCard } from '../components/JobCard';

const PAGE = 30;

const STATUS_OPTIONS: { value: JobStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'הכול' },
  { value: 'new', label: 'חדשות' },
  { value: 'saved', label: 'נשמרו להמשך' },
  { value: 'applied', label: 'הוגשו' },
  { value: 'dismissed', label: 'לא רלוונטיות' },
  { value: 'closed', label: 'נסגרו' },
];

const DAYS_OPTIONS = [
  { value: 0, label: 'כל הזמן' },
  { value: 1, label: 'היום' },
  { value: 7, label: '7 ימים' },
  { value: 30, label: '30 ימים' },
];

/** All jobs with filters: status, company, score range, date; search box (SPEC.md section 9.3). */
export function JobsDbScreen() {
  const [records, setRecords] = useState<JobRecord[] | null>(null);
  const [cvs, setCvs] = useState<CV[]>([]);
  const [f, setF] = useState<JobFilter>(DEFAULT_FILTER);
  const [shown, setShown] = useState(PAGE);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([listAllJobs(), listCvs()]);
      setRecords(r);
      setCvs(c);
    } catch (e) {
      setError((e as Error).message);
      setRecords([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const filtered = useMemo(() => (records ? filterJobs(records, f) : []), [records, f]);
  const companies = useMemo(() => (records ? companiesOf(records) : []), [records]);
  const set = <K extends keyof JobFilter>(k: K, v: JobFilter[K]) => { setF({ ...f, [k]: v }); setShown(PAGE); };
  const cvName = (id: string) => cvs.find((c) => c.id === id)?.name ?? 'גרסה שנמחקה';

  if (!records) return <p className="muted">טוען…</p>;
  if (error) return <div className="status status--error">{error}</div>;
  if (records.length === 0) {
    return <EmptyState icon="💼" title="המאגר ריק" text="אחרי החיפוש הראשון (✨ ההתאמות היומיות) כל המשרות שנאספו יופיעו כאן." />;
  }

  const filtersOn = JSON.stringify(f) !== JSON.stringify(DEFAULT_FILTER);

  return (
    <div className="stack">
      <section className="card stack">
        <input
          className="input"
          type="search"
          placeholder="חיפוש בכותרת, חברה, מיקום או תיאור…"
          value={f.query}
          onChange={(e) => set('query', e.target.value)}
          aria-label="חיפוש"
        />
        <div className="grid2">
          <label className="field">
            <span className="field__label">סטטוס</span>
            <select className="input" value={f.status} onChange={(e) => set('status', e.target.value as JobFilter['status'])}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">חברה</span>
            <select className="input" value={f.company} onChange={(e) => set('company', e.target.value)}>
              <option value="">כל החברות</option>
              {companies.map((c) => <option key={c} value={c}>{c}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">ציון מ-</span>
            <input className="input ltr" type="number" min={0} max={100} value={f.minScore}
              onChange={(e) => set('minScore', Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 0)} />
          </label>
          <label className="field">
            <span className="field__label">עד</span>
            <input className="input ltr" type="number" min={0} max={100} value={f.maxScore}
              onChange={(e) => set('maxScore', Number.isFinite(e.target.valueAsNumber) ? e.target.valueAsNumber : 100)} />
          </label>
          <label className="field">
            <span className="field__label">נמצאו ב-</span>
            <select className="input" value={f.days} onChange={(e) => set('days', Number(e.target.value))}>
              {DAYS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          </label>
        </div>
        <div className="row">
          <span className="field__hint grow">
            {filtered.length.toLocaleString('he-IL')} מתוך {records.length.toLocaleString('he-IL')} משרות
          </span>
          {filtersOn && (
            <button className="btn btn--ghost btn--small" onClick={() => { setF(DEFAULT_FILTER); setShown(PAGE); }}>
              ניקוי סינון
            </button>
          )}
        </div>
      </section>

      {filtered.length === 0 ? (
        <EmptyState icon="🔍" title="אין משרות שמתאימות לסינון" />
      ) : (
        <div className="job-list">
          {filtered.slice(0, shown).map(({ job, match, application }) => (
            <JobCard key={job.id} job={job} match={match} cvName={match ? cvName(match.bestCvId) : undefined}>
              <JobActions job={job} match={match} application={application} cvs={cvs} onChanged={() => void load()} />
            </JobCard>
          ))}
          {shown < filtered.length && (
            <button className="btn" onClick={() => setShown(shown + PAGE)}>
              הצגת עוד ({filtered.length - shown} נותרו)
            </button>
          )}
        </div>
      )}
    </div>
  );
}
