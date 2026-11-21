import type { useMaterialDetailState } from "./useMaterialDetailState";
import type { deriveMaterialDetail } from "./deriveMaterialDetail";

export type MaterialDetailState = ReturnType<typeof useMaterialDetailState>;
export type MaterialDetailCtx = MaterialDetailState & ReturnType<typeof deriveMaterialDetail>;
