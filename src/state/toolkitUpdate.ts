import type { ToolkitState } from "@/domain/types";
import type { useAppData } from "@/state/AppDataContext";

type Mutate = ReturnType<typeof useAppData>["mutate"];

/**
 * Change the toolkit from the latest saved copy, not from a render-time copy,
 * so a field another caller just saved is kept. Returns null when not ready.
 */
export function updateToolkit(mutate: Mutate, change: (current: ToolkitState) => ToolkitState) {
  return mutate(async (repos) => repos.toolkit.save(change(await repos.toolkit.get())));
}
