import { DOMAINS } from '@/shared/types';

/** Toggleable chips for the DOMAINS list. */
export function DomainChips(props: { value: string[]; onChange: (next: string[]) => void; label?: string }) {
  const toggle = (d: string) =>
    props.onChange(props.value.includes(d) ? props.value.filter((x) => x !== d) : [...props.value, d]);
  return (
    <div className="chips" role="group" aria-label={props.label ?? 'תחומים'}>
      {DOMAINS.map((d) => {
        const on = props.value.includes(d);
        return (
          <button
            key={d}
            type="button"
            className={on ? 'chip chip--on' : 'chip'}
            aria-pressed={on}
            onClick={() => toggle(d)}
          >
            {d}
          </button>
        );
      })}
    </div>
  );
}
