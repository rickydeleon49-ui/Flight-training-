import { useEffect } from "react";
import { SectionDraftDiscard } from "@/pages/StudyLibrary/GeminiJobNotice";
import { AlertIcon, Button } from "@/components/ui";
import { useAppData } from "@/state/AppDataContext";
import { useGeminiJobs, type GeminiJob } from "@/state/GeminiJobs";

/**
 * Gemini answers whose document has since been deleted (GEN-REL-02). Such an
 * answer can never be saved, and its material page no longer exists, so it is
 * shown here, on every screen, until the student dismisses it. Dismissing it frees
 * its place in the journal.
 */
const deletedOnPurpose = new Set<string>();

/** Documents the student deleted on purpose: AI answers for them are not worth a notice. */
export function markDeletedOnPurpose(materialId: string) {
  deletedOnPurpose.add(materialId);
}

export function GeminiOrphanNotices() {
  const { data, status } = useAppData();
  const jobs = useGeminiJobs();
  const present = new Set(data.materials.map((material) => material.id));
  // Answers for a document deleted on purpose are quietly cleared, no notice.
  const quiet = status !== "ready" ? [] : jobs.jobs.filter(
    (job) => deletedOnPurpose.has(job.materialId) && !present.has(job.materialId) && job.phase !== "running" && job.phase !== "saving" && job.phase !== "discarding" && job.phase !== "discard-failed",
  );
  useEffect(() => {
    for (const job of quiet) void jobs.dismiss(job.key);
  }, [quiet.map((job) => job.key).join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  if (status !== "ready") return null;
  const orphans = jobs.jobs.filter(
    (job) => !present.has(job.materialId) && !deletedOnPurpose.has(job.materialId) && job.phase !== "running" && job.phase !== "saving",
  );
  if (orphans.length === 0) return null;
  return (
    <section className="stack stack--3" aria-label="AI answers for deleted documents" style={{ marginBottom: "var(--space-4)" }}>
      {orphans.map((job) => (
        <OrphanNotice key={job.key} job={job} onDismiss={() => void jobs.dismiss(job.key)} />
      ))}
    </section>
  );
}

function OrphanNotice({ job, onDismiss }: { job: GeminiJob; onDismiss: () => void }) {
  const jobs = useGeminiJobs();
  const helper = (job.answer?.model ?? job.sections?.model)?.startsWith("claude-") ? "Claude" : "Gemini";
  const what = job.kind === "study-kit" ? "a study kit" : job.kind === "flashcards" ? "flashcards" : job.kind === "study-aid" ? "a study guide and cards" : "a practice test";
  const message =
    job.phase === "discard-failed"
      ? job.error
      : job.phase === "discarding"
        ? "Dismissing…"
        : job.sectionGuide
          ? "This document was removed. Your finished sections are kept in a draft."
          : job.phase === "failed" || job.phase === "interrupted"
            ? `Creating ${what} for a document that has since been deleted did not finish. Nothing was saved.`
            : `${helper} finished ${what} for a document that has since been deleted, so it could not be saved. Your library is unchanged.`;
  return (
    <div className="stack stack--2">
      <div className="ai-disclaimer" role={job.phase === "discard-failed" ? "alert" : "status"}>
        <AlertIcon size={16} />
        <p className="tiny">{message}</p>
      </div>
      {job.phase !== "discarding" ? (
        <div className="row row--wrap">
          {job.sectionGuide ? <SectionDraftDiscard job={job} jobs={jobs} /> : (
            <Button size="small" variant="secondary" onClick={onDismiss}>
              {job.phase === "discard-failed" ? "Try again" : "Dismiss"}
            </Button>
          )}
        </div>
      ) : null}
    </div>
  );
}
