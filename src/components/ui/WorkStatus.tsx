import { useEffect, useState } from "react";

/** Whole seconds since `active` became true; 0 while inactive. Ticks once a second. */
export function useElapsed(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    setElapsed(0);
    if (!active) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => window.clearInterval(timer);
  }, [active]);
  return elapsed;
}

/** Seconds appear only once a wait is long enough to need reassurance. */
export const SHOW_SECONDS_AFTER = 5;

interface Props {
  /** What is happening right now, e.g. "Saving…". */
  phase: string;
  elapsed: number;
  className?: string;
}

/** One honest progress line for a long wait: the current step plus elapsed seconds after 5 s. */
export function WorkStatus({ phase, elapsed, className }: Props) {
  return (
    <p className={className ?? "small"} role="status">
      {phase}{elapsed >= SHOW_SECONDS_AFTER ? ` · ${elapsed} s` : ""}
    </p>
  );
}
