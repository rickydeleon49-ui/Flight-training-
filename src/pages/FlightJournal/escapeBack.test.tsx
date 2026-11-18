// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter, Route, Routes, useNavigate } from "react-router-dom";
import { afterEach, expect, it } from "vitest";

import { useEscapeBack } from "./useEscapeBack";

afterEach(cleanup);

function Entry() {
  const navigate = useNavigate();
  useEscapeBack(() => navigate("/journal"));
  return <p>Entry open</p>;
}
const open = () => render(<MemoryRouter initialEntries={["/journal/1"]}><Routes>
  <Route path="/journal/1" element={<Entry />} />
  <Route path="/journal" element={<p>Log list</p>} />
</Routes></MemoryRouter>);

it("Esc closes an open entry like Back", () => {
  open();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByText("Log list")).toBeTruthy();
});

it("Esc inside an open dialog leaves the entry open", () => {
  open();
  const dialog = document.createElement("dialog");
  dialog.setAttribute("open", "");
  document.body.appendChild(dialog);
  fireEvent.keyDown(document, { key: "Escape" });
  expect(screen.getByText("Entry open")).toBeTruthy();
  dialog.remove();
});

it("Esc while typing in a field leaves the entry open", () => {
  open();
  const input = document.createElement("input");
  document.body.appendChild(input);
  fireEvent.keyDown(input, { key: "Escape" });
  expect(screen.getByText("Entry open")).toBeTruthy();
  input.remove();
});
