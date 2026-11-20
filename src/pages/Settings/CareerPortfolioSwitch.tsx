import { Card, CardBody, CardHeader, Checkbox } from "@/components/ui";
import { useAppData } from "@/state/AppDataContext";
import { updateToolkit } from "@/state/toolkitUpdate";

/** Career Portfolio is hidden in the Pilot Toolkit until this is switched on. */
export function CareerPortfolioSwitch() {
  const { data, mutate } = useAppData();
  const on = data.toolkit.showCareerPortfolio === true;
  return (
    <Card variant="grouped">
      <CardHeader title="Pilot Toolkit tiles" eyebrow="What shows" />
      <CardBody>
        <div className="settings-rows">
          <Checkbox
            appearance="switch"
            checked={on}
            onChange={(next) => void updateToolkit(mutate, (toolkit) => ({ ...toolkit, showCareerPortfolio: next }))}
            strikethrough={false}
            label="Show Career Portfolio"
          />
        </div>
      </CardBody>
    </Card>
  );
}
