import { useCallback, useEffect, useState } from 'react';
import { send } from '@/shared/messages';
import type { CV, RunState, Settings } from '@/shared/types';
import { getJobsForToday, listCvs, type JobWithMatch } from '@/db/repo';
import { getSettings } from '@/shared/storage';
import { localDateStr } from '@/shared/utils';
import { isActive } from '@/pipeline/run';
import { ProgressBar } from '../components/ProgressBar';
import { EmptyState } from '../components/EmptyState';
import { JobCard } from '../components/JobCard';

const PHASE_LABEL: Record<RunState['phase'], string> = {
  fetch: 'אוספת משרות',
  prefilter: 'מסננת',
  overlap: 'משווה לקורות החיים',
  ai: 'מנתחת עם AI',
  done: 'הסתיים',
  error: 'נעצר בשגיאה',
};

interface Data {
  jobs: JobWithMatch[];
  cvs: CV[];
  settings: Settings;
}

export function TodayScreen() {
  const [run, setRun] = useState<RunState | null>(null);
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const refreshRun = useCallback(async () => {
    try {
      setRun(await send('getRunState'));
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  const refreshJobs = useCallback(async () => {
    try {
      const settings = await getSettings();
      const [jobs, cvs] = await Promise.all([getJobsForToday(settings.minScoreToShow), listCvs()]);
      setData({ jobs, cvs, settings });
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => { void refreshRun(); void refreshJobs(); }, [refreshRun, refreshJobs]);

  // Poll while a run is active.
  const active = isActive(run ?? undefined);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void refreshRun(), 1000);
    return () => clearInterval(t);
  }, [active, refreshRun]);

  // New matches appear as each AI call finishes, and once more when the run ends.
  const analyzed = run?.aiDone.length ?? 0;
  useEffect(() => { void refreshJobs(); }, [analyzed, active, refreshJobs]);

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
  const settings = data?.settings;
  const callsLeft = settings && run
    ? Math.max(0, settings.dailyCallLimit - (run.callsDate === localDateStr() ? run.callsToday : 0))
    : undefined;
  const cvName = (id: string) => data?.cvs.find((c) => c.id === id)?.name ?? 'גרסה שנמחקה';

  return (
    <div className="stack">
      <button className="btn btn--primary btn--big" onClick={onStart} disabled={starting || active}>
        {active ? 'החיפוש רץ…' : starting ? 'מתחילה…' : 'לחיפוש של היום'}
      </button>

      {error && <div className="status status--error">{error}</div>}

      {data && data.cvs.length === 0 && (
        <p className="notice">עוד לא הועלו קורות חיים — בלעדיהם אפשר לאסוף משרות אבל לא לדרג אותן (לשונית 📄 קורות חיים).</p>
      )}
      {data && data.cvs.length > 0 && !data.settings.geminiApiKey && (
        <p className="notice">לא הוגדר מפתח Gemini — המשרות ייאספו ויסוננו, אבל לא ינותחו (⚙️ הגדרות ← Gemini).</p>
      )}

      {run && (
        <section className="card stack" aria-live="polite">
          <div className="row">
            <h2 className="card__title grow">
              {run.kind === 'full' ? 'ריצה ראשונה (מלאה)' : 'ריצה יומית'} · {PHASE_LABEL[run.phase]}
            </h2>
            <span className="field__hint">{new Date(run.startedAt).toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' })}</span>
          </div>

          <ProgressBar label="חברות שנבדקו" value={run.companiesDone.length} max={p?.companiesTotal ?? 0} />
          {run.aiQueue.length > 0 && (
            <ProgressBar label="נותחו עם AI" value={analyzed} max={run.aiQueue.length} />
          )}

          {p && (
            <div className="stats-row">
              <Stat label="משרות פתוחות" value={p.jobsSeen} />
              <Stat label="חדשות" value={p.jobsNew} />
              <Stat label="עברו סינון" value={p.jobsPassedPrefilter ?? 0} />
            </div>
          )}
          {callsLeft !== undefined && (
            <span className="field__hint">קריאות AI שנותרו היום: {callsLeft.toLocaleString('he-IL')} מתוך {settings!.dailyCallLimit.toLocaleString('he-IL')}</span>
          )}

          {run.errors.length > 0 && (
            <details className="errors" open={run.errors.length <= 3}>
              <summary>{run.errors.length} שגיאות</summary>
              <ul>
                {run.errors.map((e, i) => (
                  <li key={i}>
                    <strong>{e.company ?? (e.source === 'ai' ? 'AI' : e.source)}</strong>: {e.message}
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

      {data && data.jobs.length > 0 && (
        <section className="stack">
          <div className="list-head">
            <h2>משרות מתאימות</h2>
            <span className="field__hint">{data.jobs.length} עם ציון {data.settings.minScoreToShow} ומעלה</span>
          </div>
          <div className="job-list">
            {data.jobs.map(({ job, match }) => (
              <JobCard key={job.id} job={job} match={match} cvName={cvName(match.bestCvId)} />
            ))}
          </div>
        </section>
      )}

      {data && data.jobs.length === 0 && run && !active && data.cvs.length > 0 && (
        <EmptyState
          icon="🔍"
          title="אין עדיין התאמות להצגה"
          text={`אין משרות חדשות עם ציון ${data.settings.minScoreToShow} ומעלה. אפשר להוריד את הסף בהגדרות או לחכות לריצה הבאה.`}
        />
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
