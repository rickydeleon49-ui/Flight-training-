import { Badge, Button } from "@/components/ui";
import { formatMb, useFigurePack, type FigurePackDescriptor } from "@/logic/figurePacks";
import { FAA_EDITION } from "@/logic/figures";

/** One card for an optional figure pack: not downloaded, downloading, available, or a retry after an error. */
export function FigurePackCard({ pack, questionCount, onStart }: {
  pack: FigurePackDescriptor;
  questionCount: number;
  onStart: () => void;
}) {
  const state = useFigurePack(pack);
  const { status, downloading, progress, error } = state;
  const count = pack.figures.length;
  const installed = status?.installed === true && !downloading;
  const total = progress?.total || pack.bytes;
  const received = Math.min(progress?.received ?? 0, total);
  const percent = total > 0 ? Math.round((received / total) * 100) : 0;

  return (
    <section className="card figure-pack" aria-label="Sectional charts">
      {downloading ? <>
        <div><Badge tone="study">Downloading</Badge></div>
        <h3 className="ai-guide__title">Practice with sectional charts</h3>
        <div className="toolkit-progress" role="progressbar" aria-label="Sectional chart download"
          aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent}>
          <span style={{ width: `${percent}%` }} />
        </div>
        <p className="small">{formatMb(received)} of {formatMb(total)} MB</p>
        <p className="tiny dim">You can keep studying while this finishes.</p>
        <div className="row"><Button variant="secondary" onClick={state.cancel}>Cancel</Button></div>
      </> : installed ? <>
        <div><Badge tone="complete">Available offline</Badge></div>
        <h3 className="ai-guide__title">Practice with sectional charts</h3>
        <p className="small">{count} sectional excerpts are on this device.</p>
        <p className="tiny figure-pack__credit">{FAA_EDITION} · Practice, not for flight</p>
        <div className="row"><Button variant="primary" onClick={onStart}>Start sectional quiz</Button></div>
        <div className="row">
          <Button variant="ghost" size="small" onClick={() => { void state.remove(); }}>
            Remove download ({formatMb(status?.bytes ?? 0)} MB)
          </Button>
        </div>
        {error ? <p className="small" role="alert">{error}</p> : null}
      </> : <>
        <div><Badge tone="neutral">Not downloaded yet</Badge></div>
        <h3 className="ai-guide__title">Practice with sectional charts</h3>
        <p className="small">Adds {count} sectional excerpts and about {questionCount} questions. Download once, then use them offline.</p>
        <p className="tiny dim">About {formatMb(pack.bytes)} MB · Needs internet for the download</p>
        {error ? <p className="small" role="alert">{error}</p> : null}
        <div className="row">
          <Button variant="primary" disabled={status === null} onClick={() => { void state.download(); }}>
            {error ? "Try again" : "Download sectionals"}
          </Button>
        </div>
        <p className="tiny dim">Offline? The rest of the figure drill still works.</p>
      </>}
    </section>
  );
}
