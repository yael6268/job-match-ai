/** Match score 0–100 as a colored circle: strong (80+), good (60+), weak. */
export function ScoreBadge(props: { score: number }) {
  const tier = props.score >= 80 ? 'high' : props.score >= 60 ? 'mid' : 'low';
  return (
    <div className={`score score--${tier}`} role="img" aria-label={`ציון התאמה ${props.score} מתוך 100`}>
      {props.score}
    </div>
  );
}
