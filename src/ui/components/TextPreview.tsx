import { useState } from 'react';

/** Side-by-side tabs for the full extracted text and the redacted text that goes to the AI. */
export function TextPreview(props: { text: string; redactedText: string }) {
  const [view, setView] = useState<'full' | 'redacted'>('redacted');
  const shown = view === 'full' ? props.text : props.redactedText;
  return (
    <div className="preview">
      <div className="seg" role="tablist" aria-label="תצוגת טקסט">
        <button type="button" role="tab" aria-selected={view === 'redacted'} className={view === 'redacted' ? 'seg__btn seg__btn--on' : 'seg__btn'} onClick={() => setView('redacted')}>
          מה יישלח ל-AI
        </button>
        <button type="button" role="tab" aria-selected={view === 'full'} className={view === 'full' ? 'seg__btn seg__btn--on' : 'seg__btn'} onClick={() => setView('full')}>
          טקסט מלא
        </button>
      </div>
      <pre className="preview__text" dir="auto">{shown || '(ריק)'}</pre>
      <div className="field__hint">
        {view === 'redacted'
          ? 'אימייל, טלפון, קישורים אישיים וכתובת הוסרו. קישורי GitHub ותיק עבודות נשארים.'
          : 'הטקסט המלא נשמר רק בדפדפן ולא נשלח לשום מקום.'}
        {' '}{shown.length.toLocaleString('he-IL')} תווים
      </div>
    </div>
  );
}
