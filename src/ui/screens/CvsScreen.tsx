import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CV } from '@/shared/types';
import { deleteCv, listCvs, saveCv, updateCvMeta } from '@/db/repo';
import { ACCEPTED_CV_TYPES, extractCvText } from '@/cv/extract';
import { redactCvText } from '@/cv/redact';
import { EmptyState } from '../components/EmptyState';
import { DomainChips } from '../components/DomainChips';
import { TextPreview } from '../components/TextPreview';
import { Status, type StatusMsg } from '../components/Status';

export function CvsScreen() {
  const [cvs, setCvs] = useState<CV[] | null>(null);
  const [loadError, setLoadError] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);

  const reload = useCallback(async () => {
    try {
      setCvs(await listCvs());
      setLoadError('');
    } catch (e) {
      setLoadError((e as Error).message || 'טעינת קורות החיים נכשלה');
      setCvs([]);
    }
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  if (!cvs) return <p className="muted">טוען…</p>;

  const onDone = async () => {
    setEditing(null);
    await reload();
  };

  return (
    <div className="stack">
      {loadError && <div className="status status--error">{loadError}</div>}

      {cvs.length === 0 && editing !== 'new' && (
        <EmptyState icon="📄" title="עדיין אין קורות חיים" text="אפשר להעלות כמה גרסאות (למשל QA ו-Backend). לכל משרה נמליץ על הגרסה המתאימה.">
          <button className="btn btn--primary" onClick={() => setEditing('new')} style={{ marginTop: 12 }}>
            העלאת קורות חיים
          </button>
        </EmptyState>
      )}

      {cvs.map((cv) =>
        editing === cv.id ? (
          <CvEditor key={cv.id} existing={cv} onDone={onDone} onCancel={() => setEditing(null)} />
        ) : (
          <CvCard key={cv.id} cv={cv} onEdit={() => setEditing(cv.id)} onDeleted={reload} />
        ),
      )}

      {editing === 'new' && <CvEditor onDone={onDone} onCancel={() => setEditing(null)} />}

      {cvs.length > 0 && editing === null && (
        <button className="btn" onClick={() => setEditing('new')}>+ הוספת גרסה</button>
      )}
    </div>
  );
}

function CvCard(props: { cv: CV; onEdit: () => void; onDeleted: () => void }) {
  const { cv } = props;
  const [open, setOpen] = useState(false);
  const [msg, setMsg] = useState<StatusMsg>(null);

  const onDelete = async () => {
    if (!confirm(`למחוק את גרסת קורות החיים "${cv.name}"?`)) return;
    try {
      await deleteCv(cv.id);
      props.onDeleted();
    } catch {
      setMsg({ kind: 'error', text: 'המחיקה נכשלה' });
    }
  };

  const onDownload = () => {
    const url = URL.createObjectURL(cv.fileBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = cv.fileName;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <section className="card stack">
      <div className="row cv-head">
        <div className="grow">
          <h2 className="card__title">{cv.name}</h2>
          <div className="field__hint">
            <span dir="ltr">{cv.fileName}</span> · עודכן {new Date(cv.updatedAt).toLocaleDateString('he-IL')}
          </div>
        </div>
      </div>
      {cv.domains.length > 0 ? (
        <div className="chips">
          {cv.domains.map((d) => <span key={d} className="chip chip--on chip--static">{d}</span>)}
        </div>
      ) : (
        <p className="notice">לא נבחרו תחומים — בלי תחום, משרות לא יעברו את הסינון הראשוני עבור הגרסה הזו.</p>
      )}
      <div className="row wrap">
        <button className="btn" onClick={() => setOpen(!open)} aria-expanded={open}>{open ? 'הסתרת טקסט' : 'הצגת טקסט'}</button>
        <button className="btn" onClick={props.onEdit}>עריכה / החלפת קובץ</button>
        <button className="btn btn--ghost" onClick={onDownload}>הורדת הקובץ</button>
        <button className="btn btn--danger" onClick={onDelete}>מחיקה</button>
      </div>
      {open && <TextPreview text={cv.text} redactedText={cv.redactedText} />}
      <Status msg={msg} />
    </section>
  );
}

interface Picked {
  fileName: string;
  fileBlob: Blob;
  text: string;
}

function CvEditor(props: { existing?: CV; onDone: () => void; onCancel: () => void }) {
  const { existing } = props;
  const [name, setName] = useState(existing?.name ?? '');
  const [domains, setDomains] = useState<string[]>(existing?.domains ?? []);
  const [picked, setPicked] = useState<Picked | null>(null);
  const [extracting, setExtracting] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<StatusMsg>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const redacted = useMemo(() => (picked ? redactCvText(picked.text) : ''), [picked]);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setMsg(null);
    setExtracting(true);
    try {
      const text = await extractCvText(file, file.name);
      setPicked({ fileName: file.name, fileBlob: file, text });
      if (!name.trim()) setName(file.name.replace(/\.(pdf|docx)$/i, ''));
    } catch (e) {
      setPicked(null);
      setMsg({ kind: 'error', text: (e as Error).message });
      if (fileRef.current) fileRef.current.value = '';
    } finally {
      setExtracting(false);
    }
  };

  const canSave = name.trim() !== '' && (picked !== null || existing !== undefined) && !extracting && !saving;

  const onSave = async () => {
    setSaving(true);
    setMsg(null);
    try {
      if (picked) {
        await saveCv({ id: existing?.id, name, domains, ...picked });
      } else if (existing) {
        await updateCvMeta(existing.id, { name, domains });
      }
      props.onDone();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message || 'השמירה נכשלה' });
      setSaving(false);
    }
  };

  return (
    <form className="card stack" onSubmit={(e) => { e.preventDefault(); if (canSave) void onSave(); }}>
      <h2 className="card__title">{existing ? `עריכת "${existing.name}"` : 'גרסת קורות חיים חדשה'}</h2>

      <label className="field">
        <span className="field__label">{existing ? 'החלפת קובץ (לא חובה)' : 'קובץ (PDF או DOCX)'}</span>
        <input
          ref={fileRef}
          className="input"
          type="file"
          accept={ACCEPTED_CV_TYPES}
          onChange={(e) => void onFile(e.target.files?.[0])}
          disabled={extracting || saving}
        />
        {existing && !picked && <span className="field__hint">קובץ נוכחי: <span dir="ltr">{existing.fileName}</span></span>}
      </label>

      {extracting && <div className="status status--info">מחלצת טקסט מהקובץ…</div>}

      <label className="field">
        <span className="field__label">שם הגרסה<span className="req" aria-hidden> *</span></span>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="למשל: QA, Backend" required />
      </label>

      <div className="field">
        <span className="field__label">תחומים שהגרסה מתאימה להם</span>
        <DomainChips value={domains} onChange={setDomains} />
      </div>

      {picked && (
        <div className="field">
          <span className="field__label">בדיקת הטקסט שחולץ</span>
          <TextPreview text={picked.text} redactedText={redacted} />
        </div>
      )}

      <Status msg={msg} />
      <div className="row">
        <button type="submit" className="btn btn--primary" disabled={!canSave}>{saving ? 'שומרת…' : 'שמירה'}</button>
        <button type="button" className="btn btn--ghost" onClick={props.onCancel} disabled={saving}>ביטול</button>
      </div>
    </form>
  );
}
