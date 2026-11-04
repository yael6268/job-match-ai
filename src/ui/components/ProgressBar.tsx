export function ProgressBar(props: { label: string; value: number; max: number }) {
  const pct = props.max > 0 ? Math.min(100, Math.round((props.value / props.max) * 100)) : 0;
  return (
    <div className="progress">
      <div className="progress__label">
        <span>{props.label}</span>
        <span className="ltr">{props.value}/{props.max}</span>
      </div>
      <div
        className="progress__track"
        role="progressbar"
        aria-label={props.label}
        aria-valuemin={0}
        aria-valuemax={props.max}
        aria-valuenow={props.value}
      >
        <div className="progress__fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}
