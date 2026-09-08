import { describe, expect, it, vi } from "vitest";

import { restoreDocumentCopy } from "./documentRecovery";

const document = {
  relativePath: "mat-handbook.pdf",
  originalFileName: "handbook.pdf",
  fileSize: 123,
};

describe("missing attachment recovery", () => {
  it("keeps the imported copy after its material record is saved", async () => {
    const remove = vi.fn();
    await expect(
      restoreDocumentCopy("mat", async () => document, async () => undefined, remove),
    ).resolves.toEqual(document);
    expect(remove).not.toHaveBeenCalled();
  });

  it("removes the imported copy when saving the record fails", async () => {
    const remove = vi.fn(async () => undefined);
    await expect(
      restoreDocumentCopy(
        "mat",
        async () => document,
        async () => {
          throw new Error("database unavailable");
        },
        remove,
      ),
    ).rejects.toThrow("database unavailable");
    expect(remove).toHaveBeenCalledWith(document.relativePath);
  });

  it("does nothing when the file picker is cancelled", async () => {
    const save = vi.fn();
    await expect(
      restoreDocumentCopy("mat", async () => null, save, vi.fn()),
    ).resolves.toBeNull();
    expect(save).not.toHaveBeenCalled();
  });
});
