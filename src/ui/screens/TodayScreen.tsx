import { useCallback, useEffect, useState } from 'react';
import { send } from '@/shared/messages';
import type { RunState } from '@/shared/types';
import { isActive } from '@/pipeline/run';
import { ProgressBar } from '../components/ProgressBar';
import { EmptyState } from '../components/EmptyState';

const PHASE_LABEL: Record<RunState['phase'], string> = {
  fetch: 'אוספת משרות',
  prefilter: 'מסננת',
  overlap: 'משווה לקורות החיים',
  ai: 'מנתחת עם AI',
  done: 'הסתיים',
  error: 'נעצר בשגיאה',
};

export function TodayScreen() {
  const [run, setRun] = useState<RunState | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const refresh = useCallback(async () => {
    try {
      setRun(await send('getRunState'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  // Poll while a run is active.
  const active = isActive(run ?? undefined);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refresh(), 1000);
    return () => clearInterval(t);
  }, [active, refresh]);

  const onStart = async () => {
    setStarting(true);
    try {
      setRun(await send('startRun'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setStarting(false);
    }
  };

  const p = run?.progress;

  return (
    <div className="stack">
      <button className="btn btn--primary btn--big" onClick={onStart} disabled={starting || active}>
        {active ? 'החיפוש רץ…' : starting ? 'מתחילה…' : 'לחיפוש של היום'}
      </button>

      {error && <div className="status status--error">{error}</div>}

      {run && (
        <section className="card stack" aria-live="polite">
          <div className="row">
            <h2 className="card__title grow">
              {run.kind === 'full' ? 'ריצה ראשונה (מלאה)' : 'ריצה יומית'} · {PHASE_LABEL[run.phase]}
            </h2>
            <span className="field__hint">{new Date(run.startedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>

          <ProgressBar label="חברות שנבדקו" value={run.companiesDone.length} max={p?.companiesTotal ?? 0} />

          {p && (
            <div className="stats-row">
              <Stat label="משרות פתוחות" value={p.jobsSeen} />
              <Stat label="חדשות" value={p.jobsNew} />
              <Stat label="נסגרו" value={p.jobsClosed} />
            </div>
          )}

          {run.errors.length > 0 && (
            <details className="errors" open={run.errors.length <= 3}>
              <summary>{run.errors.length} שגיאות</summary>
              <ul>
                {run.errors.map((e, i) => (
                  <li key={i}>
                    <strong>{e.company ?? e.source}</strong>: {e.message}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </section>
      )}

      {!run && !error && (
        <EmptyState icon="✨" title="עוד לא רץ חיפוש" text="לחיצה על הכפתור תאסוף את המשרות הפתוחות מכל החברות ברשימה (הגדרות ← חברות)." />
      )}

      {run?.phase === 'done' && (
        <p className="muted">דירוג המשרות לפי התאמה לקורות החיים יגיע בשלב 4.</p>
      )}
    </div>
  );
}

function Stat(props: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat__value">{props.value.toLocaleString('he-IL')}</div>
      <div className="stat__label">{props.label}</div>
    </div>
  );
}
