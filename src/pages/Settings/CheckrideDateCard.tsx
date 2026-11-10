import { Button, Card, CardBody, CardHeader, TypedDateField } from "@/components/ui";
import { normalizeCheckrideDate } from "@/logic/toolkit";
import { useAppData } from "@/state/AppDataContext";

export const CHECKRIDE_COUNTDOWN_LINE = "We'll count down the days on your Flight Deck.";

/** The practical test day: one date, with Clear. Nothing is set until you pick one. */
export function CheckrideDateCard() {
  const { data, mutate } = useAppData();
  const current = normalizeCheckrideDate(data.toolkit.checkrideDate);
  const save = (checkrideDate: string | null) =>
    mutate((repos) => repos.toolkit.save({ ...data.toolkit, checkrideDate }));

  return (
    <Card>
      <CardHeader title="Checkride date" eyebrow="On this device" />
      <CardBody>
        <div className="stack stack--3">
          <TypedDateField
            label="Checkride date"
            value={current ?? ""}
            onChange={(date) => {
              const next = normalizeCheckrideDate(date);
              if (next && next !== current) void save(next);
            }}
          />
          <div>
            <Button variant="ghost" disabled={!current} onClick={() => void save(null)}>
              Clear
            </Button>
          </div>
          <p className="small muted">{CHECKRIDE_COUNTDOWN_LINE}</p>
        </div>
      </CardBody>
    </Card>
  );
}
