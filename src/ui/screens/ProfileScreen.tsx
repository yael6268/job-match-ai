import { useEffect, useState } from 'react';
import { EMPTY_PROFILE, NOT_IN_EXTENSION_MSG, getProfile, saveProfile } from '@/shared/storage';
import type { Profile } from '@/shared/types';
import { Status, type StatusMsg } from '../components/Status';

type Key = keyof Profile;

const FIELDS: { key: Key; label: string; type: string; ltr?: boolean; required?: boolean; autoComplete: string }[] = [
  { key: 'firstName', label: 'שם פרטי', type: 'text', required: true, autoComplete: 'given-name' },
  { key: 'lastName', label: 'שם משפחה', type: 'text', required: true, autoComplete: 'family-name' },
  { key: 'fullName', label: 'שם מלא (כפי שיופיע בטפסים)', type: 'text', required: true, autoComplete: 'name' },
  { key: 'email', label: 'אימייל', type: 'email', ltr: true, required: true, autoComplete: 'email' },
  { key: 'phone', label: 'טלפון', type: 'tel', ltr: true, required: true, autoComplete: 'tel' },
  { key: 'linkedin', label: 'קישור ל-LinkedIn', type: 'url', ltr: true, autoComplete: 'url' },
  { key: 'city', label: 'עיר מגורים', type: 'text', autoComplete: 'address-level2' },
];

export function ProfileScreen() {
  const [p, setP] = useState<Profile | null>(null);
  const [msg, setMsg] = useState<StatusMsg>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    getProfile().then(setP, () => setP(EMPTY_PROFILE));
  }, []);

  if (!p) return <p className="muted">טוען…</p>;

  const update = (key: Key, value: string) => {
    const next = { ...p, [key]: value };
    // Keep the full name in sync while the user hasn't customised it.
    const autoFull = `${p.firstName} ${p.lastName}`.trim();
    if ((key === 'firstName' || key === 'lastName') && (p.fullName === '' || p.fullName === autoFull)) {
      next.fullName = `${next.firstName} ${next.lastName}`.trim();
    }
    setP(next);
    setMsg(null);
  };

  const onSave = async () => {
    setSaving(true);
    try {
      const trimmed = Object.fromEntries(Object.entries(p).map(([k, v]) => [k, (v ?? '').trim()])) as unknown as Profile;
      await saveProfile(trimmed);
      setP(trimmed);
      setMsg({ kind: 'ok', text: 'הפרטים נשמרו' });
    } catch (e) {
      const text = (e as Error).message === NOT_IN_EXTENSION_MSG ? NOT_IN_EXTENSION_MSG : 'השמירה נכשלה';
      setMsg({ kind: 'error', text });
    } finally {
      setSaving(false);
    }
  };

  return (
    <form className="stack" onSubmit={(e) => { e.preventDefault(); void onSave(); }}>
      <p className="muted">הפרטים נשמרים רק בדפדפן שלך ומשמשים למילוי טפסי הגשה. הם לא נשלחים ל-AI.</p>
      <section className="card stack">
        {FIELDS.map((f) => (
          <label key={f.key} className="field">
            <span className="field__label">
              {f.label}
              {f.required && <span className="req" aria-hidden> *</span>}
            </span>
            <input
              className={f.ltr ? 'input ltr' : 'input'}
              type={f.type}
              required={f.required}
              autoComplete={f.autoComplete}
              value={p[f.key] ?? ''}
              onChange={(e) => update(f.key, e.target.value)}
            />
          </label>
        ))}
      </section>
      <div className="savebar">
        <button type="submit" className="btn btn--primary" disabled={saving}>
          {saving ? 'שומרת…' : 'שמירת פרטים'}
        </button>
        <Status msg={msg} />
      </div>
    </form>
  );
}
