import { useState } from "react";

import { Button, Card, CardBody } from "@/components/ui";
import {
  INOP_CHECKS,
  INOP_DISCLAIMER,
  INOP_MEL_QUESTION,
  INOP_START,
  INOP_TITLE,
  inopAnswer,
  type InopState,
} from "@/logic/inoperativeEquipment";

/** Collapsed yes/no walk-through for 14 CFR 91.213(d); no saved state. */
export function InoperativeEquipmentCard() {
  const [state, setState] = useState<InopState>(INOP_START);
  const question =
    state.kind === "mel" ? INOP_MEL_QUESTION : state.kind === "check" ? INOP_CHECKS[state.index]! : null;

  return (
    <Card>
      <CardBody>
        <details>
          <summary>{INOP_TITLE}</summary>
          <div aria-live="polite">
            {state.kind === "check" ? (
              <p className="muted">Check {state.index + 1} of {INOP_CHECKS.length}</p>
            ) : null}
            {question ? <p>{question}</p> : <p>{state.kind === "end" ? state.text : ""}</p>}
            {state.kind === "end" ? <p className="muted">{INOP_DISCLAIMER}</p> : null}
          </div>
          <div className="chart-symbol-actions">
            {question ? (
              <>
                <Button variant="primary" onClick={() => setState(inopAnswer(state, true))}>Yes</Button>
                <Button onClick={() => setState(inopAnswer(state, false))}>No</Button>
              </>
            ) : null}
            <Button onClick={() => setState(INOP_START)}>Start over</Button>
          </div>
        </details>
      </CardBody>
    </Card>
  );
}
