import { useCallback, useEffect, useRef, useState } from 'react';
import { deleteContact, importContacts, listContacts, saveContact } from '@/db/repo';
import { parseContactsCsv } from '@/shared/contacts';
import type { Contact } from '@/shared/types';
import { EmptyState } from '../components/EmptyState';
import { Status, type StatusMsg } from '../components/Status';

type Draft = Omit<Contact, 'id'> & { id?: string };
const EMPTY: Draft = { name: '', company: '', email: '', referralLink: '', notes: '' };

/** Contacts CRUD + CSV import (name,company,email,referralLink,notes) — SPEC.md section 9.6. */
export function ContactsScreen() {
  const [list, setList] = useState<Contact[] | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [msg, setMsg] = useState<StatusMsg>(null);
  const [csvOpen, setCsvOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      setList(await listContacts());
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
      setList([]);
    }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const onSave = async () => {
    if (!draft) return;
    try {
      await saveContact(draft);
      setDraft(null);
      setMsg({ kind: 'ok', text: 'איש הקשר נשמר' });
      await load();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    }
  };

  const onDelete = async (c: Contact) => {
    if (!confirm(`למחוק את ${c.name} (${c.company})?`)) return;
    await deleteContact(c.id);
    await load();
  };

  if (!list) return <p className="muted">טוען…</p>;

  return (
    <div className="stack">
      <p className="field__hint">
        אנשי קשר בחברות שמעניינות אותך. כשיש משרה בחברה שלהם, בכרטיס המשרה יופיעו "הגשה דרך הפניה" ו"בקשת הפניה במייל".
        ההתאמה לחברה היא לפי השם או השמות הנוספים שלה (בלי תלות באותיות גדולות וסימנים).
      </p>

      <div className="row wrap">
        <button className="btn btn--primary" onClick={() => { setMsg(null); setDraft({ ...EMPTY }); }} disabled={!!draft}>
          + איש קשר
        </button>
        <button className="btn" onClick={() => setCsvOpen(!csvOpen)}>ייבוא מ-CSV</button>
      </div>

      {draft && <ContactForm draft={draft} onChange={setDraft} onSave={() => void onSave()} onCancel={() => setDraft(null)} />}
      {csvOpen && <CsvImport onDone={async (text) => { setMsg(text); setCsvOpen(false); await load(); }} />}
      <Status msg={msg} />

      {list.length === 0 && !draft ? (
        <EmptyState icon="👥" title="אין עדיין אנשי קשר" text="אפשר להוסיף אחד אחד, או לייבא קובץ CSV עם העמודות name,company,email,referralLink,notes." />
      ) : (
        <ul className="contact-list">
          {list.map((c) => (
            <li key={c.id} className="card contact">
              <div className="row">
                <div className="grow">
                  <div className="contact__name" dir="auto">{c.name}</div>
                  <div className="field__hint" dir="auto">{c.company}</div>
                </div>
                <button className="btn btn--small btn--ghost" onClick={() => { setMsg(null); setDraft({ ...c }); }}>עריכה</button>
                <button className="btn btn--small btn--danger" onClick={() => void onDelete(c)}>מחיקה</button>
              </div>
              <div className="contact__meta">
                {c.email && <a className="ltr" href={`mailto:${c.email}`}>{c.email}</a>}
                {c.referralLink && <a href={c.referralLink} target="_blank" rel="noreferrer">קישור הפניה</a>}
                {c.notes && <span className="muted" dir="auto">{c.notes}</span>}
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ContactForm(props: { draft: Draft; onChange: (d: Draft) => void; onSave: () => void; onCancel: () => void }) {
  const d = props.draft;
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => props.onChange({ ...d, [k]: v });
  return (
    <form className="card company-form stack" onSubmit={(e) => { e.preventDefault(); props.onSave(); }}>
      <div className="grid2">
        <label className="field">
          <span className="field__label">שם <span className="req">*</span></span>
          <input className="input" value={d.name} onChange={(e) => set('name', e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">חברה <span className="req">*</span></span>
          <input className="input" value={d.company} onChange={(e) => set('company', e.target.value)} required />
        </label>
        <label className="field">
          <span className="field__label">מייל</span>
          <input className="input ltr" type="email" value={d.email ?? ''} onChange={(e) => set('email', e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">קישור הפניה</span>
          <input className="input ltr" type="url" value={d.referralLink ?? ''} onChange={(e) => set('referralLink', e.target.value)} placeholder="https://" />
        </label>
      </div>
      <label className="field">
        <span className="field__label">הערות</span>
        <input className="input" value={d.notes ?? ''} onChange={(e) => set('notes', e.target.value)} />
      </label>
      <div className="row">
        <button type="submit" className="btn btn--primary btn--small">שמירה</button>
        <button type="button" className="btn btn--ghost btn--small" onClick={props.onCancel}>ביטול</button>
      </div>
    </form>
  );
}

function CsvImport(props: { onDone: (msg: StatusMsg) => void }) {
  const [text, setText] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);
  const preview = text.trim() ? parseContactsCsv(text) : null;

  const onImport = async () => {
    if (!preview || preview.contacts.length === 0) return;
    try {
      const { added, updated } = await importContacts(preview.contacts);
      const skipped = preview.errors.length ? `, ${preview.errors.length} שורות דולגו` : '';
      props.onDone({ kind: 'ok', text: `יובאו ${added} חדשים ועודכנו ${updated}${skipped}.` });
    } catch (e) {
      props.onDone({ kind: 'error', text: (e as Error).message });
    }
  };

  return (
    <section className="card stack">
      <h2 className="card__title">ייבוא אנשי קשר מ-CSV</h2>
      <p className="field__hint ltr">name,company,email,referralLink,notes</p>
      <div className="row">
        <button type="button" className="btn btn--small" onClick={() => fileRef.current?.click()}>בחירת קובץ</button>
        <span className="field__hint">או הדבקה למטה</span>
        <input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv,text/plain"
          hidden
          onChange={async (e) => { const f = e.target.files?.[0]; if (f) setText(await f.text()); }}
        />
      </div>
      <textarea className="input ltr" rows={5} value={text} onChange={(e) => setText(e.target.value)} placeholder="Dana Example,Wix,dana@example.com,https://…,notes" />
      {preview && (
        <div className="field__hint">
          {preview.contacts.length} אנשי קשר תקינים
          {preview.errors.length > 0 && (
            <ul className="errors">
              {preview.errors.slice(0, 5).map((e) => <li key={e.line}>שורה {e.line}: {e.message}</li>)}
            </ul>
          )}
        </div>
      )}
      <div className="row">
        <button type="button" className="btn btn--primary btn--small" disabled={!preview?.contacts.length} onClick={() => void onImport()}>
          ייבוא {preview?.contacts.length ? `(${preview.contacts.length})` : ''}
        </button>
      </div>
    </section>
  );
}
