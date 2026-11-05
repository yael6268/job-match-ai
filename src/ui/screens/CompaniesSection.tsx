import { useEffect, useState } from 'react';
import {
  addSuggestedCompanies, companyKey, deleteCompany, getCompanies, missingSuggestions, saveCompany,
} from '@/shared/companies';
import { send } from '@/shared/messages';
import type { Company, SourceName } from '@/shared/types';
import { SUPPORTED_SOURCES } from '@/sources';
import { Status, type StatusMsg } from '../components/Status';

const SOURCE_LABEL: Record<SourceName, string> = {
  greenhouse: 'Greenhouse',
  lever: 'Lever',
  comeet: 'Comeet',
  smartrecruiters: 'SmartRecruiters',
};

const BOARD_HINT: Record<SourceName, string> = {
  greenhouse: 'מהכתובת boards.greenhouse.io/‹מזהה›',
  lever: 'מהכתובת jobs.lever.co/‹מזהה›',
  comeet: 'מתמלא מהקישור, בצורה 49.004',
  smartrecruiters: 'מהכתובת jobs.smartrecruiters.com/‹מזהה› או careers.smartrecruiters.com/‹מזהה› (רגיש לאותיות גדולות)',
};

const EMPTY: Company = { name: '', source: 'greenhouse', boardId: '', enabled: true };

type TestResult = Record<string, StatusMsg>;

export function CompaniesSection() {
  const [list, setList] = useState<Company[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<{ key?: string; draft: Company } | null>(null);
  const [msg, setMsg] = useState<StatusMsg>(null);
  const [tests, setTests] = useState<TestResult>({});

  useEffect(() => {
    getCompanies().then(setList, (e: Error) => { setLoadError(e.message); setList([]); });
  }, []);

  const apply = async (fn: () => Promise<Company[]>, okText?: string) => {
    try {
      setList(await fn());
      setMsg(okText ? { kind: 'ok', text: okText } : null);
      return true;
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
      return false;
    }
  };

  const onTest = async (c: Company) => {
    const key = companyKey(c);
    setTests((t) => ({ ...t, [key]: { kind: 'info', text: 'בודקת…' } }));
    try {
      const { count } = await send('testCompany', { company: c });
      setTests((t) => ({ ...t, [key]: { kind: 'ok', text: `נמצאו ${count} משרות` } }));
    } catch (e) {
      setTests((t) => ({ ...t, [key]: { kind: 'error', text: (e as Error).message } }));
    }
  };

  if (!list) return <p className="muted">טוען…</p>;

  const enabledCount = list.filter((c) => c.enabled).length;
  const suggestions = missingSuggestions(list);

  const onAddSuggested = async () => {
    try {
      const { list: next, added } = await addSuggestedCompanies();
      setList(next);
      setMsg({ kind: 'ok', text: `נוספו ${added} חברות. אפשר ללחוץ "בדיקה" ליד כל אחת או פשוט להריץ חיפוש.` });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <section className="card stack">
      <div className="row">
        <h2 className="card__title grow">חברות</h2>
        <span className="field__hint">{enabledCount} פעילות מתוך {list.length}</span>
      </div>
      <p className="field__hint">
        המשרות נאספות רק מממשקי ה-API הציבוריים של לוחות המשרות. מקורות נתמכים כרגע: {SUPPORTED_SOURCES.map((s) => SOURCE_LABEL[s]).join(', ')}.
      </p>
      {loadError && <div className="status status--error">{loadError}</div>}
      {list.length === 0 && !loadError && <p className="notice">אין חברות ברשימה. הוסיפי לפחות חברה אחת כדי להתחיל.</p>}

      {suggestions.length > 0 && !loadError && (
        <div className="notice stack">
          <span>
            {suggestions.length} חברות מומלצות עם משרות פיתוח בישראל עוד לא ברשימה:{' '}
            {suggestions.map((c) => c.name).join(', ')}.
          </span>
          <button type="button" className="btn btn--small" onClick={() => void onAddSuggested()} style={{ alignSelf: 'flex-start' }}>
            הוספת {suggestions.length} החברות המומלצות
          </button>
        </div>
      )}

      <ul className="company-list">
        {list.map((c) => {
          const key = companyKey(c);
          if (editing?.key === key) {
            return (
              <li key={key}>
                <CompanyForm
                  draft={editing.draft}
                  onChange={(draft) => setEditing({ key, draft })}
                  onCancel={() => setEditing(null)}
                  onSave={async () => { if (await apply(() => saveCompany(editing.draft, key), 'נשמר')) setEditing(null); }}
                />
              </li>
            );
          }
          return (
            <li key={key} className={c.enabled ? 'company' : 'company company--off'}>
              <div className="row">
                <label className="check grow">
                  <input
                    type="checkbox"
                    checked={c.enabled}
                    onChange={() => void apply(() => saveCompany({ ...c, enabled: !c.enabled }, key))}
                    aria-label={`${c.name} פעילה`}
                  />
                  <span className="company__name">{c.name}</span>
                  {c.example && <span className="badge">דוגמה</span>}
                </label>
                <span className="field__hint ltr">{SOURCE_LABEL[c.source]} · {c.boardId}{c.country ? ` · ${c.country}` : ''}</span>
              </div>
              <div className="row wrap">
                <button className="btn btn--small" onClick={() => void onTest(c)}>בדיקה</button>
                <button className="btn btn--small btn--ghost" onClick={() => setEditing({ key, draft: c })}>עריכה</button>
                <button
                  className="btn btn--small btn--danger"
                  onClick={() => { if (confirm(`למחוק את ${c.name} מהרשימה?`)) void apply(() => deleteCompany(key)); }}
                >
                  מחיקה
                </button>
              </div>
              <Status msg={tests[key] ?? null} />
            </li>
          );
        })}
      </ul>

      {editing && editing.key === undefined ? (
        <CompanyForm
          draft={editing.draft}
          onChange={(draft) => setEditing({ draft })}
          onCancel={() => setEditing(null)}
          onSave={async () => { if (await apply(() => saveCompany(editing.draft), 'החברה נוספה')) setEditing(null); }}
          onTest={() => void onTest(editing.draft)}
          testMsg={tests[companyKey(editing.draft)] ?? null}
        />
      ) : (
        <button className="btn" onClick={() => { setMsg(null); setEditing({ draft: EMPTY }); }} disabled={!!editing}>
          + הוספת חברה
        </button>
      )}
      <Status msg={msg} />
    </section>
  );
}

/** Paste a Comeet careers-page link: the background reads the page and fills uid + token. */
function ComeetLinkField(props: { draft: Company; onChange: (c: Company) => void }) {
  const [link, setLink] = useState('');
  const [msg, setMsg] = useState<StatusMsg>(null);
  const [busy, setBusy] = useState(false);

  const onResolve = async () => {
    setBusy(true);
    setMsg({ kind: 'info', text: 'קוראת את עמוד הקריירה…' });
    try {
      const { companyUid, token } = await send('resolveComeet', { url: link });
      // Name defaults to the slug in the link when the user has not typed one.
      const slug = /comeet\.com\/jobs\/([^/?#]+)/i.exec(link)?.[1] ?? '';
      props.onChange({ ...props.draft, boardId: companyUid, token, name: props.draft.name || slug });
      setMsg({ kind: 'ok', text: `נמצא: מזהה ${companyUid} וטוקן. אפשר ללחוץ "בדיקה".` });
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="field">
      <span className="field__label">קישור לעמוד המשרות ב-Comeet</span>
      <span className="row">
        <input
          className="input ltr grow"
          value={link}
          onChange={(e) => setLink(e.target.value)}
          placeholder="https://www.comeet.com/jobs/‹חברה›/‹מזהה›"
          spellCheck={false}
        />
        <button type="button" className="btn btn--small" onClick={() => void onResolve()} disabled={busy || !link.trim()}>
          שליפת פרטים
        </button>
      </span>
      <Status msg={msg} />
    </div>
  );
}

function CompanyForm(props: {
  draft: Company;
  onChange: (c: Company) => void;
  onSave: () => void;
  onCancel: () => void;
  onTest?: () => void;
  testMsg?: StatusMsg;
}) {
  const { draft: d } = props;
  const set = <K extends keyof Company>(k: K, v: Company[K]) => props.onChange({ ...d, [k]: v });
  return (
    <div className="company-form stack">
      <div className="grid2">
        <label className="field">
          <span className="field__label">שם החברה</span>
          <input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} placeholder="למשל: Riskified" />
        </label>
        <label className="field">
          <span className="field__label">מקור</span>
          <select
            className="input ltr"
            value={d.source}
            onChange={(e) => {
              const source = e.target.value as SourceName;
              // SmartRecruiters boards are global: default to Israeli postings only.
              props.onChange({ ...d, source, country: source === 'smartrecruiters' ? d.country ?? 'il' : undefined });
            }}
          >
            {SUPPORTED_SOURCES.map((s) => <option key={s} value={s}>{SOURCE_LABEL[s]}</option>)}
          </select>
        </label>
      </div>
      {d.source === 'comeet' && <ComeetLinkField draft={d} onChange={props.onChange} />}
      <label className="field">
        <span className="field__label">מזהה הלוח</span>
        <input className="input ltr" value={d.boardId} onChange={(e) => set('boardId', e.target.value)} spellCheck={false} />
        <span className="field__hint">{BOARD_HINT[d.source]}</span>
      </label>
      {d.source === 'comeet' && (
        <label className="field">
          <span className="field__label">טוקן Comeet</span>
          <input className="input ltr" value={d.token ?? ''} onChange={(e) => set('token', e.target.value)} spellCheck={false} />
          <span className="field__hint">מתמלא אוטומטית מהקישור למעלה. זה מפתח ציבורי שמופיע בעמוד הקריירה של החברה.</span>
        </label>
      )}
      {d.source === 'smartrecruiters' && (
        <label className="field">
          <span className="field__label">מדינה</span>
          <input
            className="input ltr"
            value={d.country ?? ''}
            onChange={(e) => set('country', e.target.value)}
            placeholder="il"
            maxLength={2}
            spellCheck={false}
          />
          <span className="field__hint">קוד בן שתי אותיות (il = ישראל). ריק = כל המדינות — איטי יותר בחברות גדולות.</span>
        </label>
      )}
      <label className="field">
        <span className="field__label">שמות נוספים (לא חובה, מופרדים בפסיק)</span>
        <input
          className="input"
          value={(d.aliases ?? []).join(', ')}
          onChange={(e) => set('aliases', e.target.value.split(',').map((a) => a.trim()))}
          placeholder="Riskified Ltd"
        />
        <span className="field__hint">משמש להתאמת אנשי קשר לחברה</span>
      </label>
      <div className="row wrap">
        <button type="button" className="btn btn--primary btn--small" onClick={props.onSave}>שמירה</button>
        {props.onTest && (
          <button type="button" className="btn btn--small" onClick={props.onTest} disabled={!d.boardId.trim()}>בדיקה</button>
        )}
        <button type="button" className="btn btn--small btn--ghost" onClick={props.onCancel}>ביטול</button>
      </div>
      {props.testMsg !== undefined && <Status msg={props.testMsg} />}
    </div>
  );
}
