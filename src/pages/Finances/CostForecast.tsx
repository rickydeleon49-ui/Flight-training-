import { useState } from "react";

import { Button, Card, CardBody, CardHeader, Field, TextInput } from "@/components/ui";
import type { ToolkitState } from "@/domain/types";
import { formatMoney } from "@/lib/money";
import { flightLogTotals, formatHours } from "@/logic/flightLog";
import { trainingCostForecast } from "@/logic/toolkit";
import { useAppData } from "@/state/AppDataContext";
import "../PilotToolkit/pilotToolkit.css";

function ForecastMetric({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="toolkit-number numeric">{value}</p>
      <p className="tiny dim">{label}</p>
    </div>
  );
}

/** The training cost forecast, shown inside Finances. */
export function CostForecast() {
  const { data, mutate } = useAppData();
  const state = data.toolkit;
  const save = async (change: (current: ToolkitState) => ToolkitState) =>
    (await mutate(async (repositories) => repositories.toolkit.save(change(await repositories.toolkit.get())))) !== null;
  const totals = flightLogTotals(data.journalEntries);
  const forecast = trainingCostForecast(totals, data.transactions, state, data.journalEntries);
  const [hourly, setHourly] = useState(String(state.estimatedHourlyCost / 100));
  const [additional, setAdditional] = useState(
    String(state.additionalTrainingCosts / 100),
  );
  const saveAssumptions = () =>
    save((current) => ({
      ...current,
      estimatedHourlyCost: Math.max(0, Math.round(Number(hourly || 0) * 100)),
      additionalTrainingCosts: Math.max(
        0,
        Math.round(Number(additional || 0) * 100),
      ),
    }));

  return (
    <div className="stack stack--5" aria-label="Cost forecast">
      <Card>
        <CardHeader
          title="Private pilot cost forecast"
          eyebrow="Planning estimate"
        />
        <CardBody>
          <div className="report-grid">
            <ForecastMetric
              label="Tracked training spending"
              value={formatMoney(forecast.spent)}
            />
            <ForecastMetric
              label="Planning hours remaining to 40"
              value={`${formatHours(forecast.remainingHours)} hr`}
            />
            <ForecastMetric
              label="Estimated remaining"
              value={formatMoney(forecast.estimatedRemaining)}
            />
            <ForecastMetric
              label="Projected tracked + remaining"
              value={formatMoney(forecast.projectedTotal)}
            />
          </div>
        </CardBody>
      </Card>
      <Card variant="grouped">
        <CardHeader title="Forecast assumptions" />
        <CardBody>
          <div className="form-grid">
            <Field
              label="Estimated cost per flight hour"
              hint={
                forecast.observedHourly !== null
                  ? `The forecast currently uses ${formatMoney(forecast.observedHourly)} per flight hour: lesson costs from ${forecast.observedLessons} ${forecast.observedLessons === 1 ? "lesson" : "lessons"} with logged flight time.`
                  : "Used until a lesson has both a recorded cost and a linked journal entry with its total time."
              }
            >
              <TextInput
                type="number"
                min="0"
                step="1"
                value={hourly}
                onChange={(event) => setHourly(event.target.value)}
              />
            </Field>
            <Field
              label="Additional remaining costs"
              hint="Ground school, tests, medical, supplies, fees, and a personal buffer."
            >
              <TextInput
                type="number"
                min="0"
                step="1"
                value={additional}
                onChange={(event) => setAdditional(event.target.value)}
              />
            </Field>
          </div>
          <Button
            className="toolkit-mt-4"
            onClick={() => void saveAssumptions()}
          >
            Save assumptions
          </Button>
        </CardBody>
      </Card>
      <p className="tiny dim">
        This is a budget scenario, not a quote. The 40-hour figure is a Part 61
        planning reference; proficiency, school program, location, aircraft,
        instructor, weather, and repeat training can materially change cost and
        time.
      </p>
    </div>
  );
}
