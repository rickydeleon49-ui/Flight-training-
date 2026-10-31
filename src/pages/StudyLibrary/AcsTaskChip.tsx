import { Badge } from "@/components/ui";
import { ACS_TASK_CATALOG } from "@/logic/acsTaskCatalog";

export function AcsTaskChip({ code }: { code?: string | null }) {
  const task = ACS_TASK_CATALOG.find((entry) => entry.code === code);
  return task ? <div><Badge>{task.code} · {task.title}</Badge></div> : null;
}
