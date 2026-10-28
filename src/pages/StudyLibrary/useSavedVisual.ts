import { useContext, useEffect, useState } from "react";
import { AppDataContext } from "@/state/AppDataContext";
import type { VisualRegion } from "@/data/visualCards";
import { readVisualPicture, type VisualPicture } from "@/services/visualCards";
import { useVisualImageLease } from "./useVisualImageLease";

export function useSavedVisual(owner: string, id?: string) {
  const lease = useVisualImageLease(Boolean(id));
  const context = useContext(AppDataContext);
  const repos = context?.repositories;
  const [loaded, setLoaded] = useState<{
    id: string;
    region: VisualRegion;
    picture: VisualPicture;
  } | null>(null);
  const [failure, setFailure] = useState<{
    id: string;
    message: string;
  } | null>(null);

  useEffect(() => {
    let live = true;
    setLoaded(null);
    setFailure(null);
    if (id && lease.active) {
      void (async () => {
        if (!repos) throw Error("This picture is unavailable.");
        const region = await repos.documents.readVisualRegion(id, owner);
        if (!region.imageMaterialId) {
          throw Error(
            "This picture was removed. Its card history is kept, but this card cannot be reviewed.",
          );
        }
        const picture = await readVisualPicture(region.imageMaterialId, region);
        if (live) setLoaded({ id, region, picture });
      })().catch((e) => {
        if (live) {
          setFailure({
            id,
            message: e instanceof Error ? e.message : "This picture is unavailable.",
          });
        }
      });
    }
    return () => {
      live = false;
    };
  }, [id, owner, repos, context?.dataRevision, lease.active]);

  return {
    loaded: lease.active && loaded?.id === id ? loaded : null,
    waiting: Boolean(id) && !lease.active,
    activate: lease.activate,
    error: failure && failure.id === id ? failure.message : null,
  };
}
