import { useEffect, useRef, useState } from "react";

import { Button, Dialog, Field, Select, TextInput } from "@/components/ui";
import { StudySetSaveError } from "@/data/persistenceErrors";
import { newId } from "@/lib/id";
import { StudyAuthoringError } from "@/logic/studyAuthoring";
import { applyPohCards, parsePohSet, POH_FIELDS, POH_TITLE_PREFIX, POH_MEMORY_LINES, POH_NOTE, POH_TYPE_MAX, POH_VALUE_MAX, POH_PROMPT_MAX, POH_ANSWER_MAX, pohCards, pohSetTitle, type PohForm } from "@/logic/pohCards";
import { authoringStateOf, emptyManualSet, frameOf, nextSetOf } from "@/logic/studySetEditing";
import { useAppData } from "@/state/AppDataContext";

const blank = (): PohForm => ({ type: "", values: {}, memory: Array.from({ length: POH_MEMORY_LINES }, () => ({ prompt: "", answer: "" })) });

/**
 * "My aircraft (from your POH)": you type your own numbers; they become ordinary cards of one
 * study set, "My aircraft: <type>", marked as yours. Saving again updates the same cards.
 */
export function MyAircraftDialog({ openRequest, hideTrigger }: {
  /** A page menu owns the button: each new number opens the dialog. */
  openRequest?: number;
  hideTrigger?: boolean;
} = {}) {
  const { data, mutate } = useAppData();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<PohForm>(blank);
  const [busy, setBusy] = useState(false);
  const busyRef = useRef(false);
  const [error, setError] = useState<string | null>(null);

  // Aircraft you have already saved, newest first; picking one fills the form from its cards.
  const saved = data.materials
    .filter((m) => m.materialType === "personal_note" && m.title.startsWith(POH_TITLE_PREFIX) && m.title.slice(POH_TITLE_PREFIX.length).trim() !== "")
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const [choice, setChoice] = useState("new");
  const fill = (id: string) => {
    setChoice(id);
    const material = saved.find((m) => m.id === id);
    const set = data.aiStudySets.find((s) => s.sourceMaterialId === id);
    setForm(material && set ? parsePohSet(material.title, set.flashcards) : blank());
  };

  const cards = pohCards(form);
  const typed = form.type.trim() !== "";
  const canSave = typed && cards.length > 0;

  const save = async () => {
    if (busyRef.current || !canSave) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    const title = pohSetTitle(form.type);
    const outcome = await mutate(async (repos) => {
      try {
        const known = (await repos.documents.list()).find((m) => m.title.trim().toLowerCase() === title.toLowerCase());
        const read = known ? await repos.documents.readStudySetForEdit(known.id) : null;
        const base = read ? { frame: frameOf(read.set), state: authoringStateOf(read.set) } : emptyManualSet(title);
        // Check the cards first, so a card that can't be saved leaves no empty study set behind.
        const state = await applyPohCards(base.state, cards);
        const material = known ?? (await repos.documents.create({ title, materialType: "personal_note", topic: "aircraft_systems" }));
        await repos.documents.saveStudySet({
          operationId: newId(),
          materialId: material.id,
          reason: read ? "edit" : "create",
          expected: read ? read.stored : null,
          next: nextSetOf(base.frame, state),
        });
        return { ok: true as const };
      } catch (failure) {
        const message = failure instanceof StudyAuthoringError || failure instanceof StudySetSaveError
          ? failure.message
          : "These cards couldn't be saved. Nothing has been saved; your text is still here.";
        return { ok: false as const, message };
      }
    });
    busyRef.current = false;
    setBusy(false);
    if (outcome?.ok) {
      setOpen(false);
    } else setError(outcome?.message ?? "These cards couldn't be saved. Nothing has been saved; your text is still here.");
  };

  const begin = () => { setError(null); if (saved[0]) fill(saved[0].id); else { setChoice("new"); setForm(blank()); } setOpen(true); };
  const beginRef = useRef(begin);
  beginRef.current = begin;
  useEffect(() => { if (openRequest) beginRef.current(); }, [openRequest]);
  const setValue = (key: string, value: string) => setForm((f) => ({ ...f, values: { ...f.values, [key]: value } }));
  const setMemory = (index: number, part: "prompt" | "answer", value: string) =>
    setForm((f) => ({ ...f, memory: f.memory.map((line, i) => (i === index ? { ...line, [part]: value } : line)) }));

  return (
    <>
      {hideTrigger ? null : <Button onClick={begin}>My aircraft cards</Button>}
      {open ? (
        <Dialog
          open
          onClose={() => { if (!busyRef.current) setOpen(false); }}
          title="My aircraft (from your POH)"
          description={POH_NOTE}
          dismissible={!busy}
          footer={
            <>
              <Button onClick={() => setOpen(false)} disabled={busy}>Cancel</Button>
              <Button variant="primary" onClick={() => void save()} disabled={busy || !canSave}>
                {busy ? "Saving…" : cards.length === 0 ? "Save cards" : `Save ${cards.length} ${cards.length === 1 ? "card" : "cards"}`}
              </Button>
            </>
          }
        >
          <div className="stack stack--3">
            {saved.length > 0 ? (
              <Field label="Aircraft">
                <Select
                  value={choice}
                  onChange={fill}
                  options={[...saved.map((m) => ({ value: m.id, label: m.title.slice(POH_TITLE_PREFIX.length).trim() })), { value: "new", label: "New aircraft" }]}
                />
              </Field>
            ) : null}
            <Field label="Aircraft type">
              <TextInput maxLength={POH_TYPE_MAX} value={form.type} onChange={(event) => setForm((f) => ({ ...f, type: event.target.value }))} />
            </Field>
            {POH_FIELDS.map((field) => (
              <Field key={field.key} label={field.label}>
                <TextInput
                  maxLength={POH_VALUE_MAX}
                  value={form.values[field.key] ?? ""}
                  placeholder={field.unit}
                  onChange={(event) => setValue(field.key, event.target.value)}
                />
              </Field>
            ))}
            <p className="small">Memory items from your POH (optional)</p>
            {form.memory.map((line, index) => (
              <div className="stack stack--2" key={index}>
                <Field label={`Memory item ${index + 1}: prompt`}>
                  <TextInput maxLength={POH_PROMPT_MAX} value={line.prompt} onChange={(event) => setMemory(index, "prompt", event.target.value)} />
                </Field>
                <Field label={`Memory item ${index + 1}: answer`}>
                  <TextInput maxLength={POH_ANSWER_MAX} value={line.answer} onChange={(event) => setMemory(index, "answer", event.target.value)} />
                </Field>
              </div>
            ))}
            {error ? <p className="field__error" role="alert">{error}</p> : null}
          </div>
        </Dialog>
      ) : null}
    </>
  );
}
