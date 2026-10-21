// @vitest-environment jsdom
import { createElement as h, type ComponentProps } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { StudyMaterial } from "@/domain/types";
import { PdfStudyKitPanel } from "./PdfStudyKitPanel";
import * as documents from "@/services/documents";
import * as gemini from "@/services/gemini";
import * as offline from "@/services/offlineContent";
import { pdfKitContentHash } from "@/data/pdfKitSources";
import { PracticeAuthoringError } from "@/data/persistenceErrors";
import { StudyContentProvenance } from "./StudyContentProvenance";
import { provenanceNote } from "@/logic/studyExport";
import { PdfItemLabel } from "./PdfItemLabel";

let desktop = true;
let confirmDiscardKit: () => void;
vi.mock("@/components/ui", async importOriginal => {
  const ui = await importOriginal<typeof import("@/components/ui")>();
  return {
    ...ui,
    ConfirmDialog: (props: ComponentProps<typeof ui.ConfirmDialog>) => {
      confirmDiscardKit = props.onConfirm;
      return h(ui.ConfirmDialog, props);
    },
  };
});
const repos = { documents: { readStoredStudySet: vi.fn(), saveStudySet: vi.fn(), readPracticeSnapshot: vi.fn(), savePracticeAuthoring: vi.fn() }, practiceSessions: { getCurrentAttempt: vi.fn() } };
const request = vi.fn().mockResolvedValue({ kind: "saved" });
const controller = { request, status: () => ({ epoch: 1, kind: "saved" }), abort: vi.fn() };
vi.mock("@/data", () => ({ isTauri: () => desktop }));
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => ({ repositories: repos, dataRevision: 0, data: { practiceTests: [], materials: [] }, mutate: (fn: (r: typeof repos) => unknown) => fn(repos) }) }));
vi.mock("@/state/navigation/useDocumentNavigation", () => ({ useNavigationController: () => ({ controller }) }));
const material = { id: "kit-material", title: "Synthetic PDF", filePath: "documents/synthetic.pdf", originalFileName: "synthetic.pdf" } as StudyMaterial;
const evidence = { page: 2, startOffset: 0, endOffset: 20, quote: "Lift: A source line." };
const fixture = () => ({ kind: "pdf-kit" as const, version: 1 as const, runId: "12345678-1234-4234-8234-123456789012", editorOperationId: "12345678-1234-4234-8234-123456789013", createdAt: "2026-10-20T12:00:00.000Z", reviewState: "review-required" as const,
  identity: { materialId: material.id, contentSha256: "a".repeat(64), selectedPages: [2], extractorVersion: 1, algorithmVersion: 1, pageCount: 2 },
  candidates: { glossary: [{ term: "Lift", prompt: "What is lift?", answer: "A source line.", sourcePage: 2, rule: "definition", evidence: [evidence] }], cloze: [], outline: [{ heading: "Lift", sourcePage: 2, sentences: [{ text: "A source line.", sourcePage: 2, evidence }], evidence: [evidence] }], questions: [{ prompt: "What is lift?", answer: "A source line.", choices: ["A source line.", "Another line."], correctIndex: 0, sourcePage: 2, evidence: [evidence], choiceEvidence: [[evidence], [evidence]] }] } });
let prepare: ReturnType<typeof vi.spyOn>;
let get: ReturnType<typeof vi.spyOn>;
let list: ReturnType<typeof vi.spyOn>;
let acknowledge: ReturnType<typeof vi.spyOn>;
let save: typeof repos.documents.saveStudySet;
const SOURCE_CHANGED = "The PDF or page choice changed since this kit was made. Rebuild it when you’re ready.";
beforeEach(() => {
  localStorage.clear(); desktop = true; vi.clearAllMocks();
  repos.documents.readStoredStudySet.mockResolvedValue(null); repos.documents.saveStudySet.mockResolvedValue({ status: "saved" });
  repos.documents.readPracticeSnapshot.mockResolvedValue(null); repos.documents.savePracticeAuthoring.mockResolvedValue({ status: "saved" }); repos.practiceSessions.getCurrentAttempt.mockResolvedValue(null);
  prepare = vi.spyOn(documents, "preparePdfStudyKit").mockResolvedValue("kit-job"); get = vi.spyOn(documents, "getPdfStudyKit").mockResolvedValue(fixture());
  list = vi.spyOn(documents, "listPdfStudyKitJobs").mockResolvedValue([]);
  acknowledge = vi.spyOn(gemini, "acknowledgeGeminiJob").mockResolvedValue(true);
  vi.spyOn(gemini, "cancelGeminiJob").mockResolvedValue({ cancelled: true, stage: "cancelled" });
  vi.spyOn(offline, "verifyOfflineDestination").mockResolvedValue("ok");
  vi.spyOn(offline, "prepareOfflineContent").mockResolvedValue({ materialId: material.id, readiness: { state: "ready" } } as never);
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); }; HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  save = repos.documents.saveStudySet;
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
function open() { return render(h(PdfStudyKitPanel, { material })); }
async function preview() { open(); fireEvent.click(await screen.findByRole("button", { name: "Make a study kit from this PDF" })); return within(await screen.findByRole("dialog", { name: "Review your PDF study kit" })); }
async function saveKit() { fireEvent.click(screen.getByRole("button", { name: "Save to study set" })); }
it("kit_button_desktop_only_works_without_gemini_key", async () => {
  desktop = false; const view = open(); expect(screen.getByRole("button", { name: "Make a study kit from this PDF" })).toHaveProperty("disabled", true); expect(screen.getByText("Making a PDF study kit works in the desktop app.")).toBeTruthy(); view.unmount(); desktop = true;
  await preview(); expect(prepare).toHaveBeenCalledWith(material.id); expect(save).not.toHaveBeenCalled();
});
it("kit_progress_cancel_keeps_saved_material", async () => {
  get.mockRejectedValue({ code: "DRAFT_NOT_READY" }); open(); fireEvent.click(await screen.findByRole("button", { name: "Make a study kit from this PDF" })); await screen.findByText("Pulling study ideas from your PDF…"); fireEvent.click(screen.getByRole("button", { name: "Cancel" })); await screen.findByText("Stopped. Your saved work is still here."); expect(gemini.cancelGeminiJob).toHaveBeenCalledWith({ jobId: "kit-job" }); expect(save).not.toHaveBeenCalled();
});
it("cache_missing_offers_local_extraction_then_retry", async () => {
  prepare.mockRejectedValueOnce({ code: "CACHE_MISSING" }); open(); fireEvent.click(screen.getByRole("button", { name: "Make a study kit from this PDF" })); fireEvent.click(await screen.findByRole("button", { name: "Read this PDF’s text" })); await waitFor(() => expect(offline.prepareOfflineContent).toHaveBeenCalledWith(material.id)); fireEvent.click(await screen.findByRole("button", { name: "Try making the kit again" })); await screen.findByRole("dialog", { name: "Review your PDF study kit" });
});
it("source_changed_asks_before_rebuild_at_open_and_save", async () => {
  get.mockRejectedValueOnce({ code: "SOURCE_CHANGED" }); open(); fireEvent.click(screen.getByRole("button", { name: "Make a study kit from this PDF" })); await screen.findByRole("button", { name: "Rebuild study kit" }); expect(prepare).toHaveBeenCalledTimes(1); fireEvent.click(screen.getByRole("button", { name: "Rebuild study kit" })); await screen.findByRole("dialog", { name: "Review your PDF study kit" }); save.mockRejectedValueOnce({ code: "SOURCE_CHANGED" }); await saveKit(); await screen.findByText("The PDF or page choice changed since this kit was made. Rebuild it when you’re ready."); expect(save).toHaveBeenCalledTimes(1); expect(prepare).toHaveBeenCalledTimes(2);
});
it("no_text_pdf_shows_plain_message_no_items", async () => {
  get.mockResolvedValue({ ...fixture(), candidates: { glossary: [], cloze: [], outline: [], questions: [] } }); open(); fireEvent.click(screen.getByRole("button", { name: "Make a study kit from this PDF" })); await screen.findByText("This PDF didn’t have text the kit could use."); expect(screen.queryByRole("button", { name: "Save to study set" })).toBeNull(); expect(save).not.toHaveBeenCalled();
});
it("preview_page_links_open_viewer_at_page", async () => {
  const scope = await preview(); fireEvent.click(scope.getAllByRole("button", { name: "Open PDF page 2" })[0]!); await waitFor(() => expect(request).toHaveBeenCalledWith({ materialId: material.id, reference: 2, provenance: "physical_index" })); expect(offline.verifyOfflineDestination).toHaveBeenCalledWith(material.id, "a".repeat(64));
});
it("save_sends_sources_only_for_kept_items_with_final_hashes", async () => {
  const scope = await preview(); fireEvent.change(scope.getByLabelText("Card 1 answer"), { target: { value: "My final answer" } }); fireEvent.click(scope.getByLabelText("Keep section 1")); await saveKit(); await screen.findByText("Study kit saved."); const op = save.mock.calls[0]![0]; expect(op.next.sections).toEqual([]); expect(op.pdfKitSources.items.every((i: { itemKind: string }) => i.itemKind === "card")).toBe(true); expect(op.pdfKitSources.items[0].contentHash).toBe(await pdfKitContentHash("card", op.next.flashcards[0]));
});
it("edited_item_saved_with_edit_origin_and_both_labels", async () => {
  const scope = await preview(); fireEvent.change(scope.getByLabelText("Card 1 answer"), { target: { value: "My edit" } }); expect(scope.getByText("Edited by you")).toBeTruthy(); expect(scope.getAllByText("Pulled from your PDF on this Mac").length).toBeGreaterThan(0); await saveKit(); await waitFor(() => expect(save).toHaveBeenCalled()); expect(save.mock.calls[0]![0].next.flashcards[0].origin).toBe("user");
});
it("questions_open_unsaved_in_03b_editor", async () => {
  const scope = await preview(); fireEvent.click(scope.getByRole("button", { name: "Review draft questions" })); const editor = within(await screen.findByRole("dialog", { name: "Review draft questions" })); expect(await editor.findByLabelText("Question 1 wording")).toHaveProperty("value", "What is lift?"); expect(repos.documents.savePracticeAuthoring).not.toHaveBeenCalled(); fireEvent.click(editor.getByRole("button", { name: "Save" })); await waitFor(() => expect(repos.documents.savePracticeAuthoring).toHaveBeenCalled()); expect(repos.documents.savePracticeAuthoring.mock.calls[0]![0].pdfKitSources.items[0].itemKind).toBe("question"); expect(repos.documents.savePracticeAuthoring.mock.calls[0]![0].next.questions[0].origin).toBeUndefined();
});
it("questions_never_autosave_and_respect_staleness_gate", async () => {
  const scope = await preview(); fireEvent.click(scope.getByRole("button", { name: "Review draft questions" })); const editor = within(await screen.findByRole("dialog", { name: "Review draft questions" })); await editor.findByLabelText("Question 1 wording"); expect(repos.documents.savePracticeAuthoring).not.toHaveBeenCalled(); repos.documents.savePracticeAuthoring.mockRejectedValueOnce(new PracticeAuthoringError("STALE_CONTENT")); fireEvent.click(editor.getByRole("button", { name: "Save" })); await editor.findByRole("button", { name: "Load the latest version" }); expect(editor.getByLabelText("Question 1 wording")).toHaveProperty("value", "What is lift?");
});
it("restart_offers_continue_review_never_autosaves", async () => {
  list.mockResolvedValue([{ id: "kit-job", materialId: material.id, stage: "received", createdAt: 1 }]); open(); expect(await screen.findByRole("button", { name: "Continue reviewing your study kit" })).toBeTruthy(); expect(get).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled(); fireEvent.click(screen.getByRole("button", { name: "Continue reviewing your study kit" })); await screen.findByRole("dialog", { name: "Review your PDF study kit" }); expect(save).not.toHaveBeenCalled();
});
it("storage_failure_keeps_draft_retry_already_saved_is_success", async () => {
  const scope = await preview(); save.mockRejectedValueOnce(new Error("storage")).mockResolvedValueOnce({ status: "already_saved" }); await saveKit(); await scope.findByText("Your kit couldn’t be saved. Your draft is still here; try saving again."); const first = save.mock.calls[0]![0]; expect(scope.getByLabelText("Card 1 answer")).toHaveProperty("value", "A source line."); await saveKit(); await screen.findByText("Study kit saved."); expect(save.mock.calls[1]![0]).toEqual(first);
});
it("pdf_label_never_ai_manual_or_verified", async () => {
  const scope = await preview(); expect(scope.getAllByText("Pulled from your PDF on this Mac").length).toBeGreaterThan(0); const pdfProvenance = { status: "valid" as const, label: "Pulled from your PDF on this Mac" as const, sources: [] }; const content = { provider: "manual" as const, model: "", questions: [{ pdfProvenance }] };
  const view = render(h(StudyContentProvenance, { sourceMaterialTitle: material.title, kind: "practice-test", content })); expect(view.container.textContent).toContain(pdfProvenance.label); expect(view.container.textContent).not.toMatch(/AI|Written by you|verified/); const note = provenanceNote({ material, studySet: null, practiceTest: content as never }, { guide: false, flashcards: false, questions: true }); expect(note).toContain(pdfProvenance.label); expect(note).not.toMatch(/AI|written by hand|verified/);
});
it("invalid_manual_kit_sources_keep_pdf_header_with_unavailable_note", () => {
  const pdfProvenance = { status: "invalid" as const, label: "PDF source details unavailable" as const, sources: [] };
  const view = render(h(StudyContentProvenance, {
    sourceMaterialTitle: material.title, kind: "practice-test",
    content: { provider: "manual", questions: [{ pdfProvenance }] },
  }));
  expect(view.container.textContent).toContain("Pulled from your PDF on this Mac");
  expect(view.container.textContent).toContain("Some source details are unavailable");
  expect(view.container.textContent).not.toMatch(/Written by you|Gemini|AI/);
  const item = render(h(PdfItemLabel, { provenance: pdfProvenance }));
  expect(item.container.textContent).toBe("Source details unavailable");
});

it("restart retains edited study content and the exact uncertain operation", async () => {
  const scope = await preview(); fireEvent.change(scope.getByLabelText("Card 1 answer"), { target: { value: "Keep my typing" } }); save.mockRejectedValueOnce(new Error("lost acknowledgement")); await saveKit(); await scope.findByText("Your kit couldn’t be saved. Your draft is still here; try saving again."); const operation = save.mock.calls[0]![0]; cleanup();
  list.mockResolvedValue([{ id: "kit-job", materialId: material.id, stage: "received", createdAt: 1 }]); open(); fireEvent.click(await screen.findByRole("button", { name: "Continue reviewing your study kit" })); const reopened = within(await screen.findByRole("dialog", { name: "Review your PDF study kit" })); expect(reopened.getByLabelText("Card 1 answer")).toHaveProperty("value", "Keep my typing"); await saveKit(); await screen.findByText("Study kit saved."); expect(save.mock.calls[1]![0]).toEqual(operation);
});
it("restart retains unsaved question edits and retries the same operation", async () => {
  const scope = await preview(); fireEvent.click(scope.getByRole("button", { name: "Review draft questions" })); const editor = within(await screen.findByRole("dialog", { name: "Review draft questions" })); fireEvent.change(await editor.findByLabelText("Question 1 wording"), { target: { value: "My question edit" } }); repos.documents.savePracticeAuthoring.mockRejectedValueOnce(new PracticeAuthoringError("IPC_TRANSPORT_ERROR")); fireEvent.click(editor.getByRole("button", { name: "Save" })); await editor.findByRole("alert"); const operation = repos.documents.savePracticeAuthoring.mock.calls[0]![0]; cleanup();
  list.mockResolvedValue([{ id: "kit-job", materialId: material.id, stage: "received", createdAt: 1 }]); open(); fireEvent.click(await screen.findByRole("button", { name: "Continue reviewing your study kit" })); const reopened = within(await screen.findByRole("dialog", { name: "Review your PDF study kit" })); fireEvent.click(reopened.getByRole("button", { name: "Review draft questions" })); const again = within(await screen.findByRole("dialog", { name: "Review draft questions" })); expect(await again.findByLabelText("Question 1 wording")).toHaveProperty("value", "My question edit"); fireEvent.click(again.getByRole("button", { name: "Save" })); await waitFor(() => expect(repos.documents.savePracticeAuthoring).toHaveBeenCalledTimes(2)); expect(repos.documents.savePracticeAuthoring.mock.calls[1]![0]).toEqual(operation);
});
it("an active attempt blocks saving PDF questions", async () => {
  repos.practiceSessions.getCurrentAttempt.mockResolvedValue({ id: "attempt" }); const scope = await preview(); fireEvent.click(scope.getByRole("button", { name: "Review draft questions" })); const editor = within(await screen.findByRole("dialog", { name: "Review draft questions" })); await editor.findByLabelText("Question 1 wording"); expect(editor.getByRole("button", { name: "Save" })).toHaveProperty("disabled", true); expect(repos.documents.savePracticeAuthoring).not.toHaveBeenCalled();
});
it("adding a kit preserves existing edited study material", async () => {
  const old = { title: "My edited guide", summary: "Keep this", summary_origin: "user", sections_json: JSON.stringify([{ heading: "My section", body: "Keep my edit", itemId: "old-section", origin: "instructor" }]), flashcards_json: "[]", source_notes: "My notes", provider: "manual", model: "", retired_json: "[]", generated_at: "2026-10-20T12:00:00.000Z", updated_at: "2026-10-20T12:00:00.000Z" }; repos.documents.readStoredStudySet.mockResolvedValue(old); await preview(); await saveKit(); await waitFor(() => expect(save).toHaveBeenCalled()); const operation = save.mock.calls[0]![0]; expect(operation.expected).toEqual(old); expect(operation.next.summary).toBe("Keep this"); expect(operation.next.sections[0]).toMatchObject({ body: "Keep my edit", origin: "instructor" }); expect(operation.pdfKitSources.items.every((i: { logicalId: string }) => i.logicalId !== "old-section")).toBe(true);
});

it("saving_all_kit_items_releases_journal_slot_and_mirrors", async () => {
  const fix = fixture();
  fix.candidates.questions = [];
  get.mockResolvedValue(fix);
  await preview();
  expect(localStorage.getItem(`hfd:pdf-kit-review:${fix.runId}`)).not.toBeNull();
  await saveKit();
  await waitFor(() => expect(save).toHaveBeenCalled());
  await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("kit-job"));
  await waitFor(() => expect(localStorage.getItem(`hfd:pdf-kit-review:${fix.runId}`)).toBeNull());
  expect(screen.queryByRole("button", { name: "Continue reviewing your study kit" })).toBeNull();
});

it("unsaved_questions_keep_kit_until_saved_or_left_out", async () => {
  const fix = fixture();
  get.mockResolvedValue(fix);
  const scope = await preview();
  await saveKit();
  await waitFor(() => expect(save).toHaveBeenCalled());
  expect(acknowledge).not.toHaveBeenCalled();
  expect(localStorage.getItem(`hfd:pdf-kit-review:${fix.runId}`)).not.toBeNull();

  fireEvent.click(scope.getByRole("button", { name: "Leave questions out" }));
  await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("kit-job"));
  await waitFor(() => expect(localStorage.getItem(`hfd:pdf-kit-review:${fix.runId}`)).toBeNull());
});

it("release_waits_for_commit_and_failed_ack_is_retried", async () => {
  const fix = fixture();
  fix.candidates.questions = [];
  get.mockResolvedValue(fix);
  let saveResolved = false;
  save.mockImplementationOnce(async () => {
    expect(acknowledge).not.toHaveBeenCalled();
    saveResolved = true;
    return { status: "saved" };
  });
  acknowledge.mockRejectedValueOnce(new Error("network error")).mockResolvedValue(true);
  await preview();
  await saveKit();
  await waitFor(() => expect(saveResolved).toBe(true));
  await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(1));
  expect(localStorage.getItem(`hfd:pdf-kit-review:${fix.runId}`)).not.toBeNull();
  await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(localStorage.getItem(`hfd:pdf-kit-review:${fix.runId}`)).toBeNull());
});

it("discard_kit_confirms_keeps_saved_content_and_frees_slot", async () => {
  const fix = fixture();
  get.mockResolvedValue(fix);
  const scope = await preview();
  repos.documents.readStoredStudySet.mockResolvedValue({ title: "Existing", summary: "Keep" });
  fireEvent.click(scope.getByRole("button", { name: "Discard this kit" }));
  const confirm = within(await screen.findByRole("dialog", { name: /Discard/ }));
  expect(confirm.getByText("Your saved study set and questions stay. Only the unsaved kit is removed.")).toBeTruthy();
  fireEvent.click(confirm.getByRole("button", { name: "Discard kit" }));
  await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("kit-job"));
  await waitFor(() => expect(localStorage.getItem(`hfd:pdf-kit-review:${fix.runId}`)).toBeNull());
  expect(screen.queryByRole("dialog", { name: "Review your PDF study kit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue reviewing your study kit" })).toBeNull();
  expect(repos.documents.saveStudySet).not.toHaveBeenCalled();
});

it("rebuild_after_source_changed_discards_then_prepares", async () => {
  prepare.mockRejectedValueOnce({ code: "SOURCE_CHANGED" });
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Make a study kit from this PDF" }));
  await screen.findByText(SOURCE_CHANGED);
  list.mockResolvedValue([{ id: "old-job", materialId: material.id, stage: "received", createdAt: 1 }]);
  prepare.mockResolvedValueOnce("new-kit-job");
  fireEvent.click(await screen.findByRole("button", { name: "Rebuild study kit" }));
  await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("old-job"));
  await waitFor(() => expect(prepare).toHaveBeenCalledTimes(2));
});

it("rebuild_does_not_prepare_when_discard_unconfirmed", async () => {
  prepare.mockRejectedValueOnce({ code: "SOURCE_CHANGED" });
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Make a study kit from this PDF" }));
  await screen.findByText(SOURCE_CHANGED);
  list.mockResolvedValue([{ id: "old-job", materialId: material.id, stage: "received", createdAt: 1 }]);
  acknowledge.mockRejectedValueOnce(new Error("failed discard"));
  fireEvent.click(await screen.findByRole("button", { name: "Rebuild study kit" }));
  await waitFor(() => expect(acknowledge).toHaveBeenCalledWith("old-job"));
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(await screen.findByText(/Try rebuilding again|Try again/)).toBeTruthy();
});

it("full_journal_or_open_kit_message_is_plain", async () => {
  prepare.mockRejectedValueOnce({ code: "JOURNAL_FULL", message: "Save or explicitly discard the earlier PDF kit first." });
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Make a study kit from this PDF" }));
  expect(await screen.findByText("Finish or discard your earlier study kit first.")).toBeTruthy();
  expect(screen.queryByText(/Your PDF kit couldn’t be opened/)).toBeNull();
});

it("save_blocked_after_source_changed_button_and_handler", async () => {
  const scope = await preview();
  save.mockRejectedValueOnce({ code: "SOURCE_CHANGED" });
  await saveKit();
  await screen.findByText(SOURCE_CHANGED);
  const saveBtn = scope.getByRole("button", { name: "Save to study set" });
  expect(saveBtn).toHaveProperty("disabled", true);
  const reactKey = Object.keys(saveBtn).find(k => k.startsWith("__reactProps"))!;
  const handler = (saveBtn as unknown as Record<string, { onClick?: () => Promise<void> }>)[reactKey]?.onClick;
  await handler?.();
  expect(save).toHaveBeenCalledTimes(1);
});

it("cancel_after_kit_finished_keeps_continue_reviewing", async () => {
  get.mockRejectedValue({ code: "DRAFT_NOT_READY" });
  vi.mocked(gemini.cancelGeminiJob).mockResolvedValueOnce({ cancelled: false, stage: "ready" });
  list.mockResolvedValue([{ id: "kit-job", materialId: material.id, stage: "ready", createdAt: 1 }]);
  open();
  fireEvent.click(await screen.findByRole("button", { name: "Make a study kit from this PDF" }));
  await screen.findByText("Pulling study ideas from your PDF…");
  fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
  expect(await screen.findByText("This kit has finished. You can continue reviewing it.")).toBeTruthy();
  expect(await screen.findByRole("button", { name: "Continue reviewing your study kit" })).toBeTruthy();
});


const DISCARD_RETRY = "Your study kit couldn’t be discarded. Try again.";
async function discard() {
  fireEvent.click(screen.getByRole("button", { name: "Discard this kit" }));
  const confirm = within(await screen.findByRole("dialog", { name: "Discard this study kit?" }));
  fireEvent.click(confirm.getByRole("button", { name: "Discard kit" }));
}

it.each(["throws", "still-listed"])("discard_failure_keeps_kit_and_offers_retry (%s)", async failure => {
  const scope = await preview();
  fireEvent.change(scope.getByLabelText("Card 1 answer"), { target: { value: "Keep this edit" } });
  const reviewKey = `hfd:pdf-kit-review:${fixture().runId}`;
  const questionsKey = `hfd:pdf-kit-questions:${fixture().runId}`;
  localStorage.setItem(questionsKey, "unsaved question edits");
  const mirror = localStorage.getItem(reviewKey);
  list.mockResolvedValue([{ id: "kit-job", materialId: material.id, stage: "ready", createdAt: 1 }]);
  if (failure === "throws") acknowledge.mockRejectedValue(new Error("discard unavailable"));
  else acknowledge.mockResolvedValue(false);
  await discard();
  expect(await screen.findByText(DISCARD_RETRY)).toBeTruthy();
  expect(scope.getByLabelText("Card 1 answer")).toHaveProperty("value", "Keep this edit");
  expect(localStorage.getItem(reviewKey)).toBe(mirror);
  expect(localStorage.getItem(questionsKey)).toBe("unsaved question edits");
  fireEvent.click(scope.getAllByRole("button", { name: "Close" })[0]!);
  expect(await screen.findByRole("button", { name: "Continue reviewing your study kit" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Discard this kit" })).toBeTruthy();
  fireEvent.click(screen.getByRole("button", { name: "Continue reviewing your study kit" }));
  const reopened = within(await screen.findByRole("dialog", { name: "Review your PDF study kit" }));
  expect(reopened.getByLabelText("Card 1 answer")).toHaveProperty("value", "Keep this edit");
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(save).not.toHaveBeenCalled();
});

it.each(["throws", "still-running", "unknown"])("discard_cancel_failure_does_not_acknowledge (%s)", async failure => {
  get.mockRejectedValue({ code: "DRAFT_NOT_READY" });
  if (failure === "throws") vi.mocked(gemini.cancelGeminiJob).mockRejectedValue(new Error("cancel unavailable"));
  else vi.mocked(gemini.cancelGeminiJob).mockResolvedValue({ cancelled: false, stage: failure === "still-running" ? "running" : null });
  open();
  fireEvent.click(screen.getByRole("button", { name: "Make a study kit from this PDF" }));
  await screen.findByText("Pulling study ideas from your PDF…");
  // Exercise the discard callback while the native worker is still running.
  act(() => confirmDiscardKit());
  expect(await screen.findByText(DISCARD_RETRY)).toBeTruthy();
  expect(acknowledge).not.toHaveBeenCalled();
  expect(screen.getByText("Pulling study ideas from your PDF…")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Cancel" })).toHaveProperty("disabled", false);
});

it.each(["acknowledged", "journal-absent"])("discard_success_clears_mirrors_and_frees_start (%s)", async confirmation => {
  await preview();
  const reviewKey = `hfd:pdf-kit-review:${fixture().runId}`;
  const questionsKey = `hfd:pdf-kit-questions:${fixture().runId}`;
  localStorage.setItem(questionsKey, "unsaved questions");
  // A failed first attempt must leave a real retry, then confirmation frees start.
  acknowledge.mockResolvedValue(false);
  list.mockResolvedValue([{ id: "kit-job", materialId: material.id, stage: "ready", createdAt: 1 }]);
  await discard();
  await screen.findByText(DISCARD_RETRY);
  let finish!: (ok: boolean) => void;
  acknowledge.mockImplementationOnce(() => new Promise<boolean>(resolve => { finish = resolve; }));
  await discard();
  await waitFor(() => expect(acknowledge).toHaveBeenCalledTimes(2));
  expect(localStorage.getItem(reviewKey)).not.toBeNull();
  expect(localStorage.getItem(questionsKey)).toBe("unsaved questions");
  list.mockResolvedValue([]);
  await act(async () => finish(confirmation === "acknowledged"));
  await waitFor(() => expect(localStorage.getItem(reviewKey)).toBeNull());
  expect(localStorage.getItem(questionsKey)).toBeNull();
  expect(screen.queryByRole("dialog", { name: "Review your PDF study kit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Continue reviewing your study kit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Discard this kit" })).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Make a study kit from this PDF" }));
  await screen.findByRole("dialog", { name: "Review your PDF study kit" });
  expect(prepare).toHaveBeenCalledTimes(2);
  expect(save).not.toHaveBeenCalled();
});

const UNAVAILABLE = "Making a study kit from your PDF isn't available in this version yet. It's coming in a later update.";
function expectNoExtractionRetry() {
  expect(screen.queryByRole("button", { name: /Try again|Try making|Read this PDF/ })).toBeNull();
  expect(screen.queryByRole("button", { name: "Make a study kit from this PDF" })).toBeNull();
  expect(document.body.textContent).not.toMatch(/EXTRACTION_UNAVAILABLE|offline_extraction_disabled/);
}
it("kit_shows_not_available_yet_without_retry", async () => {
  prepare.mockRejectedValue({ code: "EXTRACTION_UNAVAILABLE" });
  open();
  fireEvent.click(screen.getByRole("button", { name: "Make a study kit from this PDF" }));
  await screen.findByText(UNAVAILABLE);
  expectNoExtractionRetry();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(offline.prepareOfflineContent).not.toHaveBeenCalled();
});
it.each(["offline_extraction_disabled", new Error("offline_extraction_disabled"), { code: "offline_extraction_disabled" }])("read_text_disabled_maps_to_not_available_yet (%#)", async failure => {
  prepare.mockRejectedValue({ code: "CACHE_MISSING" });
  vi.mocked(offline.prepareOfflineContent).mockRejectedValue(failure);
  open();
  fireEvent.click(screen.getByRole("button", { name: "Make a study kit from this PDF" }));
  fireEvent.click(await screen.findByRole("button", { name: "Read this PDF’s text" }));
  await screen.findByText(UNAVAILABLE);
  expectNoExtractionRetry();
  expect(prepare).toHaveBeenCalledTimes(1);
  expect(offline.prepareOfflineContent).toHaveBeenCalledTimes(1);
});


it("extraction_enabled_success_never_shows_unavailable_message", async () => {
  prepare.mockRejectedValueOnce({ code: "CACHE_MISSING" });
  open();
  fireEvent.click(screen.getByRole("button", { name: "Make a study kit from this PDF" }));
  fireEvent.click(await screen.findByRole("button", { name: "Read this PDF’s text" }));
  fireEvent.click(await screen.findByRole("button", { name: "Try making the kit again" }));
  await screen.findByRole("dialog", { name: "Review your PDF study kit" });
  expect(screen.queryByText(/isn't available in this version yet/)).toBeNull();
  expect(offline.prepareOfflineContent).toHaveBeenCalledWith(material.id);
});
