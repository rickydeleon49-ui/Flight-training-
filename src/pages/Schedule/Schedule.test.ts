// @vitest-environment jsdom
import { createElement as h, type ContextType } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, expect, it, vi } from "vitest";
import { AppDataContext, EMPTY_DATA } from "@/state/AppDataContext";
import { makeEvent } from "@/testing/factories";
import { Schedule } from "./Schedule";

afterEach(cleanup);

function show(result: ReturnType<typeof makeEvent> | null) {
  const create = vi.fn().mockResolvedValue(result);
  const mutate = vi.fn(async (run) => run({ schedule: { create } }));
  const value = { data: EMPTY_DATA, mutate } as unknown as ContextType<typeof AppDataContext>;
  render(h(AppDataContext.Provider, { value }, h(MemoryRouter, { initialEntries: ["/schedule"] },
    h(Routes, null,
      h(Route, { path: "/schedule", element: h(Schedule) }),
      h(Route, { path: "/schedule/:eventId", element: h("p", null, "Lesson destination") })))));
  fireEvent.click(screen.getByRole("button", { name: "Add event" }));
  fireEvent.change(screen.getByLabelText("Title"), { target: { value: "Fictional pattern work" } });
  if (result) fireEvent.change(screen.getByLabelText("Type"), { target: { value: result.eventType } });
  fireEvent.click(screen.getByRole("dialog").querySelector(".button--primary")!);
  return create;
}

it("confirms a saved lesson and links directly to its existing preparation section", async () => {
  const create = show(makeEvent({ id: "new-synthetic", title: "Fictional pattern work" }));
  expect((await screen.findByRole("status")).textContent).toBe("Added “Fictional pattern work” to your schedule.");
  expect(create).toHaveBeenCalledWith(expect.objectContaining({ title: "Fictional pattern work" }));
  const link = screen.getByRole("link", { name: "Add preparation" });
  expect(link.getAttribute("href")).toBe("/schedule/new-synthetic#lesson-preparation");
  expect(screen.queryByRole("dialog")).toBeNull();
  fireEvent.click(link);
  expect(screen.getByText("Lesson destination")).toBeTruthy();
});

it("does not offer lesson preparation for a study session", async () => {
  show(makeEvent({ eventType: "study_session" }));
  await screen.findByRole("status");
  expect(screen.queryByRole("link", { name: "Add preparation" })).toBeNull();
});

it("keeps the form open without a success message when saving fails", async () => {
  const create = show(null);
  await waitFor(() => expect(create).toHaveBeenCalledOnce());
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByRole("link", { name: "Add preparation" })).toBeNull();
  expect(screen.getByRole("dialog")).toBeTruthy();
});
