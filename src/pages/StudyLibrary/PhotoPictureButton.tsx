import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Button } from "@/components/ui";
import { photoToPng, savePhotoPicture } from "@/services/photoPicture";
import { useAppData } from "@/state/AppDataContext";

/** iPhone: pick a photo or screenshot, save it as a picture, then cover a label on it. */
export function PhotoPictureButton() {
  const input = useRef<HTMLInputElement>(null);
  const busyRef = useRef(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const { refresh } = useAppData();
  const navigate = useNavigate();

  const chosen = async (file: File | undefined) => {
    if (!file || busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setProblem(null);
    try {
      const png = await photoToPng(file);
      const saved = await savePhotoPicture(png);
      await refresh();
      navigate(`/study/${saved.materialId}`, { state: { addPictureCard: true } });
    } catch (error) {
      setProblem(error instanceof Error && error.message ? error.message : "Couldn't save this picture. Please try again.");
    } finally {
      busyRef.current = false;
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        data-testid="photo-picture-input"
        onChange={(event) => void chosen(event.currentTarget.files?.[0])}
      />
      <Button variant="primary" disabled={busy} onClick={() => input.current?.click()}>
        {busy ? "Saving picture…" : "Picture card from a photo"}
      </Button>
      {problem ? <p role="alert" className="small">{problem}</p> : null}
    </>
  );
}
