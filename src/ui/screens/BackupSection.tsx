import { useRef, useState } from 'react';
import { backupFileName, exportBackup, importBackup, resetAllData } from '@/shared/backup';
import { Status, type StatusMsg } from '../components/Status';

/** Export / import JSON backup and "reset all data" (SPEC.md section 9.8). */
export function BackupSection() {
  const [msg, setMsg] = useState<StatusMsg>(null);
  const [busy, setBusy] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
    } catch (e) {
      setMsg({ kind: 'error', text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  const onExport = () =>
    run(async () => {
      const blob = new Blob([JSON.stringify(await exportBackup(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = backupFileName();
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setMsg({ kind: 'ok', text: 'קובץ הגיבוי ירד (ללא מפתח ה-API).' });
    });

  const onImportFile = (file: File | undefined) => {
    if (!file) return;
    if (!confirm('הייבוא יחליף את כל הנתונים הקיימים (משרות, קורות חיים, הגשות, חברות ופרטים) בתוכן הקובץ. להמשיך?')) {
      if (fileRef.current) fileRef.current.value = '';
      return;
    }
    void run(async () => {
      await importBackup(await file.text());
      setMsg({ kind: 'ok', text: 'הגיבוי יובא. החלונית תיטען מחדש…' });
      setTimeout(() => location.reload(), 1200);
    });
  };

  const onReset = () => {
    if (!confirm('למחוק את כל הנתונים? משרות, קורות חיים, הגשות, חברות, פרטי הגשה, הגדרות ומפתח ה-API יימחקו.')) return;
    if (!confirm('בטוח? אי אפשר לבטל את זה. מומלץ לייצא גיבוי קודם.')) return;
    void run(async () => {
      await resetAllData();
      location.reload();
    });
  };

  return (
    <section className="card stack">
      <h2 className="card__title">גיבוי ונתונים</h2>
      <p className="field__hint">כל הנתונים נשמרים רק בדפדפן הזה. קובץ הגיבוי כולל הכול חוץ ממפתח ה-API.</p>
      <div className="row wrap">
        <button type="button" className="btn" onClick={() => void onExport()} disabled={busy}>ייצוא גיבוי (JSON)</button>
        <button type="button" className="btn" onClick={() => fileRef.current?.click()} disabled={busy}>ייבוא גיבוי</button>
        <input
          ref={fileRef}
          type="file"
          accept="application/json,.json"
          hidden
          onChange={(e) => onImportFile(e.target.files?.[0])}
        />
        <button type="button" className="btn btn--danger" onClick={onReset} disabled={busy}>מחיקת כל הנתונים</button>
      </div>
      <Status msg={msg} />
    </section>
  );
}
