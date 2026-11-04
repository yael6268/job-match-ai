import type { Job, Match } from '@/shared/types';
import { ScoreBadge } from './ScoreBadge';

/**
 * One analyzed job (SPEC.md section 9.2): company, title, location, score, link, recommended CV,
 * reasons (collapsible) and job-specific tips. Status buttons arrive in M5.
 */
export function JobCard(props: { job: Job; match: Match; cvName: string }) {
  const { job, match } = props;
  const years = match.requiredYears ?? job.requiredYears;
  return (
    <article className="card job stack">
      <div className="row job__head">
        <ScoreBadge score={match.score} />
        <div className="grow">
          <a className="job__title" href={job.url} target="_blank" rel="noreferrer" dir="auto">
            {job.title}
          </a>
          <div className="field__hint" dir="auto">
            {job.company} · {job.location || 'מיקום לא צוין'}
          </div>
        </div>
      </div>

      <div className="job__meta">
        <span>
          קורות חיים מומלצים: <strong>{props.cvName}</strong>
        </span>
        {years !== undefined && years !== null && <span className="badge">ניסיון נדרש: {years}+ שנים</span>}
      </div>

      {match.reasons.length > 0 && (
        <details className="job__reasons">
          <summary>למה הציון {match.score}?</summary>
          <ul>
            {match.reasons.map((r, i) => <li key={i} dir="auto">{r}</li>)}
          </ul>
        </details>
      )}

      {match.tips.length > 0 && (
        <div>
          <div className="job__label">טיפים להתאמת קורות החיים למשרה</div>
          <ol className="job__tips">
            {match.tips.map((t, i) => <li key={i} dir="auto">{t}</li>)}
          </ol>
        </div>
      )}
    </article>
  );
}
