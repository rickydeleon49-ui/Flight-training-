// @vitest-environment jsdom
import { render, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { DIAGRAMS } from "@/logic/diagrams";
import { DiagramArt } from "./DiagramArt";

afterEach(() => vi.unstubAllGlobals());

it("installs the diagram's scoped rules through a constructed sheet, not a <style> element", async () => {
  const texts: string[] = [];
  class FakeSheet { replaceSync(t: string) { texts.push(t); } }
  vi.stubGlobal("CSSStyleSheet", FakeSheet);
  Object.defineProperty(document, "adoptedStyleSheets", { value: [], writable: true, configurable: true });
  const diagram = DIAGRAMS.find((d) => d.kind !== "photo")!;
  const { container, unmount } = render(<DiagramArt diagram={diagram} />);
  await waitFor(() => expect(container.querySelector("svg")).toBeTruthy());
  expect(container.querySelector("style")).toBeNull();
  await waitFor(() => expect(texts.at(-1)).toMatch(/^\.dg\w+ /));
  unmount();
  expect(texts.at(-1)).toBe("");
});
