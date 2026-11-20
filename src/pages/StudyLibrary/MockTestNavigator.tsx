import { Button } from "@/components/ui";

/** The words shown and read out for one question button; never colour alone. */
export function navStateLabel(answered: boolean, flagged: boolean, current: boolean): string {
  return [current ? "current" : "", answered ? "answered" : "not answered", flagged ? "flagged" : ""]
    .filter(Boolean).join(", ");
}

/** A drawer listing every question. Tapping a number jumps there and closes it. */
export function MockTestNavigator({ ids, answers, flags, index, onJump, onClose }: {
  ids: readonly string[];
  answers: Readonly<Record<string, string>>;
  flags: readonly string[];
  index: number;
  onJump: (index: number) => void;
  onClose: () => void;
}) {
  return <aside className="mock-nav" role="region" aria-label="Question navigator">
    <div className="row row--wrap">
      <strong>Questions</strong>
      <Button variant="secondary" onClick={onClose}>Close</Button>
    </div>
    <p className="tiny muted">A tick means answered. A flag means you marked it to check again. Current is the bold outlined number.</p>
    <ol className="mock-nav__grid">
      {ids.map((id, i) => {
        const answered = id in answers;
        const flagged = flags.includes(id);
        const label = navStateLabel(answered, flagged, i === index);
        return <li key={id}>
          <button type="button" className="mock-nav__item" aria-current={i === index ? "true" : undefined}
            aria-label={`Question ${i + 1}, ${label}`} data-answered={answered} data-flagged={flagged}
            onClick={() => { onJump(i); onClose(); }}>
            <span>{i + 1}</span>
            <span className="mock-nav__mark" aria-hidden="true">{answered ? "✓" : ""}{flagged ? "⚑" : ""}</span>
          </button>
        </li>;
      })}
    </ol>
  </aside>;
}
