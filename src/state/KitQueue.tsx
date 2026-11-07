import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { newId } from "@/lib/id";
import { getGeminiStatus, listGeminiJobs } from "@/services/gemini";
import { providerCompany } from "@/services/provider";
import { previewStudyPageSource } from "@/services/studyPageSources";
import { nowIso } from "@/lib/dates";

import { useAppData } from "./AppDataContext";
import { useGeminiJobs } from "./GeminiJobs";
import { KitQueueRunner, type BeginResult, type RunnerDeps } from "./kitQueueRunner";
import type { Consent, Queue } from "./kitQueueLogic";

interface KitQueueValue {
  queue: Queue | null;
  message: string | null;
  /** The chapters the picker is open for, or null when it is closed. */
  offered: string[] | null;
  /** Open the picker for these chapters (after a split, or from a book that has chapters). */
  offer(materialIds: string[]): void;
  /** Hide the dialog; a running queue carries on. */
  hide(): void;
  begin(chapters: { materialId: string; sourceSha256: string }[], consent: Consent): Promise<BeginResult>;
  stop(): void;
  resume(): void;
  confirmAgain(consent: Consent): void;
  retry(position: number): void;
}

const KitQueueContext = createContext<KitQueueValue | null>(null);

function newRequestId(): string {
  return `req-${typeof crypto !== "undefined" && typeof crypto.randomUUID === "function" ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`}`;
}

export function KitQueueProvider({ children }: { children: ReactNode }) {
  const app = useAppData();
  const gem = useGeminiJobs();
  const appRef = useRef(app);
  const gemRef = useRef(gem);
  appRef.current = app;
  gemRef.current = gem;
  const [queue, setQueue] = useState<Queue | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [offered, setOffered] = useState<string[] | null>(null);

  const repos = () => {
    const repositories = appRef.current.repositories;
    if (!repositories) throw new Error("The library is not ready.");
    return repositories;
  };
  const runnerRef = useRef<KitQueueRunner | null>(null);
  if (!runnerRef.current) {
    const deps: RunnerDeps = {
      now: nowIso,
      newId,
      newRequestId,
      provider: async () => providerCompany((await getGeminiStatus()).model),
      title: (id) => appRef.current.data.materials.find((m) => m.id === id)?.title ?? null,
      filePath: (id) => appRef.current.data.materials.find((m) => m.id === id)?.filePath ?? null,
      sourceSha: async (id) => {
        try { return (await previewStudyPageSource(id))?.contentSha256 ?? null; } catch { return null; }
      },
      records: () => listGeminiJobs(),
      startKit: (target, options) => gemRef.current.startKitTracked(target, options),
      cancelRunning: async (requestId) => {
        const job = gemRef.current.jobs.find((j) => j.requestId === requestId);
        if (job) await gemRef.current.cancel(job.key);
      },
      holdsUnkeptDraft: (id) => gemRef.current.jobs.some((j) => j.materialId === id && j.jobId === null && Boolean(j.answer)),
      hasSavedKit: (id) => appRef.current.data.aiStudySets.some((s) => s.sourceMaterialId === id),
      persist: (q) => repos().kitQueue.save(q),
      claim: (q) => repos().kitQueue.claim(q),
      findOpen: async () => (appRef.current.repositories ? appRef.current.repositories.kitQueue.findOpen() : null),
    };
    runnerRef.current = new KitQueueRunner(deps, (q, m) => { setQueue(q); setMessage(m); });
  }
  const runner = runnerRef.current;

  // On launch the saved queue loads paused and is checked against the journal first.
  const restored = useRef(false);
  useEffect(() => {
    if (restored.current || app.status !== "ready" || gem.recovery !== "ready") return;
    restored.current = true;
    void runner.restore().catch(() => {});
  }, [app.status, gem.recovery, runner]);

  // A change to the drafts or the journal can free a slot.
  useEffect(() => { void runner.poke().catch(() => {}); }, [gem.jobs, runner]);

  const begin = useCallback((chapters: { materialId: string; sourceSha256: string }[], consent: Consent) => runner.begin(chapters, consent), [runner]);
  const value = useMemo<KitQueueValue>(() => ({
    queue,
    message,
    offered,
    offer: (ids) => setOffered(ids),
    hide: () => setOffered(null),
    begin,
    stop: () => void runner.stop(),
    resume: () => void runner.resume(),
    confirmAgain: (consent) => void runner.confirmAgain(consent),
    retry: (position) => void runner.retry(position),
  }), [queue, message, offered, begin, runner]);

  return <KitQueueContext.Provider value={value}>{children}</KitQueueContext.Provider>;
}

export function useKitQueue(): KitQueueValue {
  const context = useContext(KitQueueContext);
  if (!context) throw new Error("useKitQueue must be used inside AppDataProvider");
  return context;
}

/** For parts that also render without the provider. */
export function useOptionalKitQueue(): KitQueueValue | null {
  return useContext(KitQueueContext);
}
