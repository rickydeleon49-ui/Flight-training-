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

type PackStore = {
  status: FigurePackStatus | null;
  downloading: boolean;
  progress: { received: number; total: number } | null;
  error: string | null;
  cancelled: boolean;
};

// Download state lives here, not in the component, so it survives a remount.
const stores = new Map<string, PackStore>();
const listeners = new Map<string, Set<() => void>>();

function storeFor(id: string): PackStore {
  let s = stores.get(id);
  if (!s) { s = { status: null, downloading: false, progress: null, error: null, cancelled: false }; stores.set(id, s); }
  return s;
}
function patch(id: string, p: Partial<PackStore>) {
  stores.set(id, { ...storeFor(id), ...p });
  listeners.get(id)?.forEach((fn) => fn());
}
function subscribe(id: string, fn: () => void) {
  let set = listeners.get(id);
  if (!set) { set = new Set(); listeners.set(id, set); }
  set.add(fn);
  return () => { set!.delete(fn); };
}

async function startDownload(pack: FigurePackDescriptor): Promise<void> {
  const id = pack.id;
  if (storeFor(id).downloading) return;
  patch(id, { cancelled: false, error: null, progress: { received: 0, total: pack.bytes }, downloading: true });
  let unlisten: (() => void) | undefined;
  let stopped = false;
  import("@tauri-apps/api/event")
    .then(({ listen }) => listen<FigurePackProgress>("figure-pack-progress", (event) => {
      if (event.payload.id === id) patch(id, { progress: { received: event.payload.received, total: event.payload.total } });
    }))
    .then((fn) => { if (stopped) fn(); else unlisten = fn; })
    .catch(() => { /* progress is a nicety */ });
  try {
    await figurePackDownload(pack);
    patch(id, { status: await figurePackStatus(id) });
  } catch {
    if (!storeFor(id).cancelled) patch(id, { error: FIGURE_PACK_ERROR });
  } finally {
    stopped = true;
    unlisten?.();
    patch(id, { downloading: false, progress: null });
  }
}

export function useFigurePack(pack: FigurePackDescriptor): FigurePackState {
  const [, bump] = useState(0);
  const packRef = useRef(pack);
  packRef.current = pack;
  const id = pack.id;

  useEffect(() => subscribe(id, () => bump((n) => n + 1)), [id]);

  useEffect(() => {
    let live = true;
    figurePackStatus(id)
      .then((s) => { if (live) patch(id, { status: s }); })
      .catch(() => { if (live) patch(id, { status: { installed: false, bytes: 0 } }); });
    return () => { live = false; };
  }, [id]);

  const download = useCallback(() => startDownload(packRef.current), []);

  const cancel = useCallback(() => {
    patch(packRef.current.id, { cancelled: true });
    figurePackCancel(packRef.current.id).catch(() => {});
  }, []);

  const remove = useCallback(async () => {
    const rid = packRef.current.id;
    patch(rid, { error: null });
    try {
      await figurePackRemove(rid);
      patch(rid, { status: { installed: false, bytes: 0 } });
    } catch {
      patch(rid, { error: "Could not remove the download. Try again." });
    }
  }, []);

  const s = storeFor(id);
  return { status: s.status, downloading: s.downloading, progress: s.progress, error: s.error, download, cancel, remove };
}
