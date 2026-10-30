// @vitest-environment jsdom
/** BUGFIX-064: a failed provider check is said plainly, not left as greyed-out buttons. */
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ status: vi.fn() }));
vi.mock("@/data", () => ({ isTauri: () => true }));
vi.mock("@/services/gemini", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/gemini")>()),
  getGeminiStatus: mocks.status,
}));

import { AskGeminiPanel } from "./AskGeminiPanel";

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const LINE = "Could not check your AI connection. Close and reopen this panel to try again.";

it("says so when the AI connection can't be checked, and checks again on reopen", async () => {
  mocks.status.mockRejectedValueOnce(new Error("ipc")).mockResolvedValue({ configured: true, model: "gemini-3.5-flash", choice: "standard" });
  render(h(AskGeminiPanel, { materialId: "m1", context: "Synthetic context" }));
  await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(1));
  fireEvent.click(screen.getByRole("button", { name: /Ask Gemini/ }));
  expect(await screen.findByText(LINE)).toBeTruthy();
  expect((screen.getByRole("button", { name: "Ask" }) as HTMLButtonElement).disabled).toBe(true);
  fireEvent.click(screen.getByRole("button", { name: /Close/ }));
  fireEvent.click(screen.getByRole("button", { name: /Ask Gemini/ }));
  await waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.queryByText(LINE)).toBeNull());
});
