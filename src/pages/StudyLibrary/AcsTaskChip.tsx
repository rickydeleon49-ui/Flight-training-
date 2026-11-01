import { Badge } from "@/components/ui";
import { ACS_TASK_CATALOG } from "@/logic/acsTaskCatalog";
import { AcsTaskSources } from "./AcsTaskSources";

export function AcsTaskChip({ code, showSources = false }: { code?: string | null; showSources?: boolean }) {
  const task = ACS_TASK_CATALOG.find((entry) => entry.code === code);
  return task ? <div><Badge>{task.code} · {task.title}</Badge>
    {showSources ? <AcsTaskSources key={task.code} code={task.code} /> : null}</div> : null;
}
