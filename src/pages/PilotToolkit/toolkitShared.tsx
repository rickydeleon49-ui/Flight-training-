import { type ToolkitState } from "@/domain/types";

/** A one-at-a-time lock: `acquire` is false while an earlier choice is still saving. */
export interface PendingChoice {
  acquire: () => boolean;
  release: () => void;
}

export interface ToolProps {
  state: ToolkitState;
  save: (change: (current: ToolkitState) => ToolkitState) => Promise<boolean>;
}

export function ReportMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="toolkit-number numeric">{value}</p>
      <p className="tiny dim">{label}</p>
    </div>
  );
}
