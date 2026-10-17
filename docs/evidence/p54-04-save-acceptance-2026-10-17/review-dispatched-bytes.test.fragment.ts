
// Review-only (independent acceptance, 2026-10-17): the bytes dispatched after
// a corrected selection must not contain the refused content.
it("review: a corrected selection dispatches bytes without the refused part", async () => {
  const leaked = { ...source, studySet: { ...set, summary: `AIza${"B".repeat(35)}` } };
  saveStudyExport.mockResolvedValue({ fileName: "cards.json", byteLength: 12 });
  render(h(ExportStudyDialog, { open: true, source: leaked, onClose: () => {} }));
  fireEvent.click(screen.getByLabelText(/Study packet \(\.json\)/));
  fireEvent.click(screen.getByRole("button", { name: "Save…" }));
  await screen.findByRole("alert");
  fireEvent.click(screen.getByLabelText(/^Study guide/));
  fireEvent.click(screen.getByRole("button", { name: "Save…" }));
  await screen.findByRole("status");
  expect(saveStudyExport).toHaveBeenCalledTimes(1);
  const [kind, , contents] = saveStudyExport.mock.calls[0];
  expect(kind).toBe("packet");
  expect(String(contents)).not.toContain("AIza");
  expect(JSON.parse(String(contents))).toBeTruthy();
});
