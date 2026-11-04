import { useEffect, useState } from 'react';
import { getStats, listCvs, type Stats } from '@/db/repo';
import type { CV } from '@/shared/types';
import { localDateStr, weekStart } from '@/shared/utils';
import { EmptyState } from '../components/EmptyState';

const WEEKS_SHOWN = 8;

interface Row { label: string; value: number; hint?: string }

/** The last N week starts (Sunday, YYYY-MM-DD), oldest first, so empty weeks show as 0. */
export function lastWeeks(n: number, now: Date = new Date()): string[] {
  const start = new Date(`${weekStart(now.toISOString())}T00:00:00`);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(start);
    d.setDate(d.getDate() - 7 * (n - 1 - i));
    return localDateStr(d);
  });
}

/** Applications per domain, per CV version, per week; total applied/saved (SPEC.md section 9.7). */
export function StatsScreen() {
  const [stats, setStats] = useState<Stats | null>(null);
  const [cvs, setCvs] = useState<CV[]>([]);
  const [error, setError] = useState('');

  useEffect(() => {
    Promise.all([getStats(), listCvs()]).then(([s, c]) => { setStats(s); setCvs(c); }, (e: Error) => setError(e.message));
  }, []);

  if (error) return <div className="status status--error">{error}</div>;
  if (!stats) return <p className="muted">טוען…</p>;

  const tiles = (
    <div className="stats-row stats-row--2">
      <Tile label="הגשות" value={stats.totalApplied} />
      <Tile label="שמורות להמשך" value={stats.totalSaved} />
    </div>
  );

  if (stats.totalApplied === 0) {
    return (
      <div className="stack">
        {tiles}
        <EmptyState icon="📊" title="עוד אין הגשות" text='כשתסמני "הגשתי" על משרה, היא תיספר כאן לפי תחום, גרסת קורות חיים ושבוע.' />
      </div>
    );
  }

  const byValue = (o: Record<string, number>, name: (k: string) => string = (k) => k): Row[] =>
    Object.entries(o).map(([k, v]) => ({ label: name(k), value: v })).sort((a, b) => b.value - a.value);
  const cvName = (id: string) => (id ? cvs.find((c) => c.id === id)?.name ?? 'גרסה שנמחקה' : 'לא צוין');
  const weeks: Row[] = lastWeeks(WEEKS_SHOWN).map((w) => ({
    label: new Date(`${w}T00:00:00`).toLocaleDateString('he-IL', { day: 'numeric', month: 'numeric' }),
    hint: `השבוע שמתחיל ב-${new Date(`${w}T00:00:00`).toLocaleDateString('he-IL')}`,
    value: stats.perWeek[w] ?? 0,
  }));

  return (
    <div className="stack">
      {tiles}
      <BarList title="הגשות לפי תחום" rows={byValue(stats.perDomain)} />
      <BarList title="הגשות לפי גרסת קורות חיים" rows={byValue(stats.perCv, cvName)} />
      <BarList title={`הגשות לפי שבוע (${WEEKS_SHOWN} שבועות אחרונים)`} rows={weeks} />
    </div>
  );
}

function Tile(props: { label: string; value: number }) {
  return (
    <div className="stat">
      <div className="stat__value">{props.value.toLocaleString('he-IL')}</div>
      <div className="stat__label">{props.label}</div>
    </div>
  );
}

/** One-series horizontal bars: label, bar, value in text ink. Bars share one scale (the max). */
function BarList(props: { title: string; rows: Row[] }) {
  const max = Math.max(1, ...props.rows.map((r) => r.value));
  return (
    <section className="card stack">
      <h2 className="card__title">{props.title}</h2>
      <ul className="bars">
        {props.rows.map((r) => (
          <li key={r.label} className="bars__row" title={`${r.hint ?? r.label}: ${r.value}`}>
            <span className="bars__label" dir="auto">{r.label}</span>
            <span className="bars__track">
              {r.value > 0 && <span className="bars__fill" style={{ width: `${(r.value / max) * 100}%` }} />}
            </span>
            <span className="bars__value">{r.value}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
