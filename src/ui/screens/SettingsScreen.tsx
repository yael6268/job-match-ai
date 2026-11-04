import { useEffect, useState } from 'react';
import { DEFAULT_SETTINGS, NOT_IN_EXTENSION_MSG, getSettings, saveSettings } from '@/shared/storage';
import type { Settings } from '@/shared/types';
import { listModels, testKey, type GeminiModel } from '@/ai/gemini';
import { Status, type StatusMsg } from '../components/Status';
import { CompaniesSection } from './CompaniesSection';

type NumberKey =
  | 'minScoreToShow' | 'minScoreToNotify' | 'runHour' | 'dailyCallLimit' | 'maxAiCandidatesPerRun'
  | 'maxRequiredYears' | 'aiDelaySeconds';

const NUMBER_FIELDS: { key: NumberKey; label: string; min: number; max: number; hint?: string }[] = [
  { key: 'minScoreToShow', label: 'ציון מינימלי להצגה', min: 0, max: 100 },
  { key: 'minScoreToNotify', label: 'ציון מינימלי להתראה', min: 0, max: 100 },
  { key: 'runHour', label: 'שעת ריצה יומית', min: 0, max: 23, hint: '0–23' },
  { key: 'dailyCallLimit', label: 'מגבלת קריאות AI ליום', min: 1, max: 100000, hint: 'כדאי לבדוק את מכסת ה-Free tier העדכנית ב-Google AI Studio' },
  { key: 'maxAiCandidatesPerRun', label: 'מקסימום משרות לניתוח AI בריצה', min: 1, max: 1000 },
  { key: 'maxRequiredYears', label: 'מקסימום שנות ניסיון נדרשות', min: 0, max: 30, hint: 'משרות שדורשות יותר יסוננו לפני ה-AI' },
  { key: 'aiDelaySeconds', label: 'השהיה בין קריאות AI (שניות)', min: 0, max: 120 },
];

export function SettingsScreen() {
  const [s, setS] = useState<Settings | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<GeminiModel[]>([]);
  const [showAllModels, setShowAllModels] = useState(false);
  const [busy, setBusy] = useState<'test' | 'models' | 'save' | null>(null);
  const [keyMsg, setKeyMsg] = useState<StatusMsg>(null);
  const [saveMsg, setSaveMsg] = useState<StatusMsg>(null);
  const [locationsText, setLocationsText] = useState('');
  const [excludedText, setExcludedText] = useState('');

  useEffect(() => {
    getSettings().then((loaded) => {
      setS(loaded);
      setLocationsText(loaded.locations.join('\n'));
      setExcludedText(loaded.excludedTitleWords.join('\n'));
    }, () => setS(DEFAULT_SETTINGS));
  }, []);

  if (!s) return <p className="muted">טוען…</p>;

  const update = <K extends keyof Settings>(key: K, value: Settings[K]) => {
    setS({ ...s, [key]: value });
    setSaveMsg(null);
  };

  const run = async (kind: 'test' | 'models' | 'save', fn: () => Promise<void>) => {
    setBusy(kind);
    try {
      await fn();
    } finally {
      setBusy(null);
    }
  };

  const onLoadModels = () =>
    run('models', async () => {
      setKeyMsg(null);
      try {
        const list = await listModels(s.geminiApiKey);
        setModels(list);
        if (!list.length) setKeyMsg({ kind: 'error', text: 'לא נמצאו מודלים זמינים למפתח הזה' });
        else if (!s.geminiModel) {
          const firstFlash = list.find((m) => m.isFlash) ?? list[0]!;
          update('geminiModel', firstFlash.id);
        }
      } catch (e) {
        setKeyMsg({ kind: 'error', text: (e as Error).message });
      }
    });

  const onTest = () =>
    run('test', async () => {
      setKeyMsg({ kind: 'info', text: 'בודקת…' });
      try {
        setKeyMsg({ kind: 'ok', text: await testKey(s.geminiApiKey, s.geminiModel) });
      } catch (e) {
        setKeyMsg({ kind: 'error', text: (e as Error).message });
      }
    });

  const onSave = () =>
    run('save', async () => {
      const locations = locationsText.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
      const excludedTitleWords = excludedText.split(/[\n,]/).map((l) => l.trim()).filter(Boolean);
      try {
        const saved = await saveSettings({ ...s, geminiApiKey: s.geminiApiKey.trim(), locations, excludedTitleWords });
        setS(saved);
        setSaveMsg({ kind: 'ok', text: 'ההגדרות נשמרו' });
      } catch (e) {
        const text = (e as Error).message === NOT_IN_EXTENSION_MSG
          ? NOT_IN_EXTENSION_MSG
          : 'יש ערכים לא תקינים — בדקי את הטווחים';
        setSaveMsg({ kind: 'error', text });
      }
    });

  const visibleModels = showAllModels ? models : models.filter((m) => m.isFlash);
  const modelOptions = visibleModels.length ? visibleModels : models;
  const currentMissing = s.geminiModel && !modelOptions.some((m) => m.id === s.geminiModel);

  return (
    <div className="stack">
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void onSave(); }}>
      <section className="card stack">
        <h2 className="card__title">Gemini</h2>

        {!s.geminiApiKey && (
          <p className="notice">
            עדיין לא הוזן מפתח API. אפשר ליצור מפתח חינמי ב-{' '}
            <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noreferrer">Google AI Studio</a>.
          </p>
        )}

        <label className="field">
          <span className="field__label">מפתח API</span>
          <span className="row">
            <input
              className="input ltr grow"
              type={showKey ? 'text' : 'password'}
              autoComplete="off"
              spellCheck={false}
              value={s.geminiApiKey}
              onChange={(e) => update('geminiApiKey', e.target.value)}
              placeholder="AIza…"
            />
            <button type="button" className="btn btn--ghost" onClick={() => setShowKey(!showKey)}>
              {showKey ? 'הסתרה' : 'הצגה'}
            </button>
          </span>
        </label>

        <div className="field">
          <span className="field__label">מודל</span>
          <span className="row">
            <select
              className="input ltr grow"
              value={s.geminiModel}
              onChange={(e) => update('geminiModel', e.target.value)}
              disabled={!models.length && !s.geminiModel}
              aria-label="מודל"
            >
              {!s.geminiModel && <option value="">— יש לטעון את רשימת המודלים —</option>}
              {currentMissing && <option value={s.geminiModel}>{s.geminiModel}</option>}
              {modelOptions.map((m) => (
                <option key={m.id} value={m.id}>{m.displayName} ({m.id})</option>
              ))}
            </select>
            <button type="button" className="btn btn--ghost" onClick={onLoadModels} disabled={!s.geminiApiKey || busy !== null}>
              {busy === 'models' ? 'טוען…' : 'טעינת מודלים'}
            </button>
          </span>
          {models.length > 0 && (
            <label className="check">
              <input type="checkbox" checked={showAllModels} onChange={(e) => setShowAllModels(e.target.checked)} />
              הצגת כל המודלים (לא רק Flash)
            </label>
          )}
        </div>

        <div className="row">
          <button type="button" className="btn" onClick={onTest} disabled={!s.geminiApiKey || busy !== null}>
            {busy === 'test' ? 'בודקת…' : 'בדיקת מפתח'}
          </button>
        </div>
        <Status msg={keyMsg} />
      </section>

      <section className="card stack">
        <h2 className="card__title">ספים ותזמון</h2>
        <div className="grid2">
          {NUMBER_FIELDS.map((f) => (
            <label key={f.key} className="field">
              <span className="field__label">{f.label}</span>
              <input
                className="input ltr"
                type="number"
                min={f.min}
                max={f.max}
                required
                value={Number.isFinite(s[f.key]) ? s[f.key] : ''}
                onChange={(e) => update(f.key, e.target.valueAsNumber)}
              />
              {f.hint && <span className="field__hint">{f.hint}</span>}
            </label>
          ))}
        </div>
      </section>

      <section className="card stack">
        <h2 className="card__title">מיקומים</h2>
        <label className="field">
          <span className="field__label">מיקום אחד בכל שורה (התאמה חלקית, עברית ואנגלית)</span>
          <textarea
            className="input"
            rows={5}
            value={locationsText}
            onChange={(e) => { setLocationsText(e.target.value); setSaveMsg(null); }}
          />
        </label>
      </section>

      <section className="card stack">
        <h2 className="card__title">תפקידים לא רלוונטיים</h2>
        <label className="field">
          <span className="field__label">מילה או ביטוי בכל שורה — משרה שהכותרת שלה מכילה אחד מהם תסונן</span>
          <textarea
            className="input ltr"
            rows={4}
            value={excludedText}
            onChange={(e) => { setExcludedText(e.target.value); setSaveMsg(null); }}
          />
        </label>
      </section>

      <div className="savebar">
        <button type="submit" className="btn btn--primary" disabled={busy !== null}>
          {busy === 'save' ? 'שומרת…' : 'שמירת הגדרות'}
        </button>
        <Status msg={saveMsg} />
      </div>
    </form>
    <CompaniesSection />
    </div>
  );
}
