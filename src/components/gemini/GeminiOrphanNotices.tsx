import { SectionDraftDiscard } from "@/pages/StudyLibrary/GeminiJobNotice";
import { AlertIcon, Button } from "@/components/ui";
import { useAppData } from "@/state/AppDataContext";
import { useGeminiJobs, type GeminiJob } from "@/state/GeminiJobs";

/**
 * Gemini answers whose document has since been deleted (GEN-REL-02). Such an
 * answer can never be saved, and its material page no longer exists, so it is
 * shown here, on every screen, until she dismisses it. Dismissing it frees
 * its place in the journal.
 */
export function GeminiOrphanNotices() {
  const { data, status } = useAppData();
  const jobs = useGeminiJobs();
  if (status !== "ready") return null;
  const present = new Set(data.materials.map((material) => material.id));
  const orphans = jobs.jobs.filter(
    (job) => !present.has(job.materialId) && job.phase !== "running" && job.phase !== "saving",
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
  const what = job.kind === "study-kit" ? "study kit" : job.kind === "flashcards" ? "flashcards" : job.kind === "study-aid" ? "study guide and cards" : "practice test";
  const message =
    job.phase === "discard-failed"
      ? job.error
      : job.phase === "discarding"
        ? "Dismissing…"
        : job.sectionGuide
          ? "This document was removed. Your finished sections are kept in a draft."
          : job.phase === "failed" || job.phase === "interrupted"
            ? `Creating a ${what} for a document that has since been deleted did not finish. Nothing was saved.`
            : `${helper} finished a ${what} for a document that has since been deleted, so it could not be saved. Your library is unchanged.`;
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
