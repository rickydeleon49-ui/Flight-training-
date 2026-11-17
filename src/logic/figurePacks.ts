import { useCallback, useEffect, useRef, useState } from "react";
import type { FaaFigure } from "./figures";

/** An optional downloadable figure pack. Generic: the real pack fills in the values. */
export type FigurePackDescriptor = {
  id: string;
  url: string;
  sha256: string;
  bytes: number;
  figures: FaaFigure[];
};

export type FigurePackStatus = { installed: boolean; bytes: number };
export type FigurePackProgress = { id: string; received: number; total: number };

export const FIGURE_PACK_ERROR = "Download didn't finish. Check your internet and try again.";

async function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  const { invoke } = await import("@tauri-apps/api/core");
  return invoke<T>(command, args);
}

export const figurePackStatus = (id: string) => call<FigurePackStatus>("figure_pack_status", { id });
export const figurePackDownload = (p: FigurePackDescriptor) =>
  call<void>("figure_pack_download", { id: p.id, url: p.url, sha256: p.sha256, bytes: p.bytes });
export const figurePackCancel = (id: string) => call<void>("figure_pack_cancel", { id });
export const figurePackRemove = (id: string) => call<void>("figure_pack_remove", { id });
export const figurePackImage = (id: string, file: string) => call<string>("figure_pack_image", { id, file });

/** Megabytes with one decimal, e.g. "3.6". */
export function formatMb(bytes: number): string {
  return (bytes / (1024 * 1024)).toFixed(1);
}

/** Loads every figure of an installed pack as a data URL, keyed by figure id. */
export async function loadFigurePackImages(pack: FigurePackDescriptor): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const figure of pack.figures) {
    const data = await figurePackImage(pack.id, figure.file);
    out.set(figure.id, `data:image/webp;base64,${data}`);
  }
  return out;
}

/** Builds a `resolveFigure` for QuickQuestionRun from a pack and its loaded images. */
export function packFigureResolver(pack: FigurePackDescriptor, images: Map<string, string>) {
  return (id: string): { figure: FaaFigure; src?: string } | undefined => {
    const figure = pack.figures.find((f) => f.id === id);
    const src = images.get(id);
    return figure && src ? { figure, src } : undefined;
  };
}

export type FigurePackState = {
  /** null until the first status answer. */
  status: FigurePackStatus | null;
  downloading: boolean;
  progress: { received: number; total: number } | null;
  error: string | null;
  download: () => Promise<void>;
  cancel: () => void;
  remove: () => Promise<void>;
};

export function useFigurePack(pack: FigurePackDescriptor): FigurePackState {
  const [status, setStatus] = useState<FigurePackStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [progress, setProgress] = useState<{ received: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const cancelled = useRef(false);
  const alive = useRef(true);
  const packRef = useRef(pack);
  packRef.current = pack;

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  useEffect(() => {
    let live = true;
    figurePackStatus(pack.id)
      .then((s) => { if (live) setStatus(s); })
      .catch(() => { if (live) setStatus({ installed: false, bytes: 0 }); });
    return () => { live = false; };
  }, [pack.id]);

  useEffect(() => {
    if (!downloading) return;
    let unlisten: (() => void) | undefined;
    let stopped = false;
    import("@tauri-apps/api/event")
      .then(({ listen }) => listen<FigurePackProgress>("figure-pack-progress", (event) => {
        if (event.payload.id === pack.id) setProgress({ received: event.payload.received, total: event.payload.total });
      }))
      .then((fn) => { if (stopped) fn(); else unlisten = fn; })
      .catch(() => { /* progress is a nicety */ });
    return () => { stopped = true; unlisten?.(); };
  }, [downloading, pack.id]);

  const download = useCallback(async () => {
    cancelled.current = false;
    setError(null);
    setProgress({ received: 0, total: packRef.current.bytes });
    setDownloading(true);
    try {
      await figurePackDownload(packRef.current);
      const next = await figurePackStatus(packRef.current.id);
      if (alive.current) setStatus(next);
    } catch {
      if (alive.current && !cancelled.current) setError(FIGURE_PACK_ERROR);
    } finally {
      if (alive.current) { setDownloading(false); setProgress(null); }
    }
  }, []);

  const cancel = useCallback(() => {
    cancelled.current = true;
    figurePackCancel(packRef.current.id).catch(() => {});
  }, []);

  const remove = useCallback(async () => {
    setError(null);
    try {
      await figurePackRemove(packRef.current.id);
      if (alive.current) setStatus({ installed: false, bytes: 0 });
    } catch {
      if (alive.current) setError("Could not remove the download. Try again.");
    }
  }, []);

  return { status, downloading, progress, error, download, cancel, remove };
}
