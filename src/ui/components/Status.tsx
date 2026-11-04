export type StatusMsg = { kind: 'ok' | 'error' | 'info'; text: string } | null;

/** Inline status line under a form or button (aria-live so screen readers announce it). */
export function Status({ msg }: { msg: StatusMsg }) {
  return (
    <div className="status-slot" aria-live="polite">
      {msg && <div className={`status status--${msg.kind}`}>{msg.text}</div>}
    </div>
  );
}
