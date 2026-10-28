// @vitest-environment jsdom
import { createElement as h, Fragment, useSyncExternalStore } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { InspectedNavigationIdentity } from "@/domain/types";
import { NavigationController } from "@/state/navigation/controller";
import { SourcePageBadge } from "./SourcePageBadge";

function gate<T>() {
  let resolve!: (value: T) => void, reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const identity: InspectedNavigationIdentity = { materialId: "m", contentSha256: "a".repeat(64), totalPages: 50, verifiedAt: "x", changed: false };
let materials: { id: string; filePath: string; title?: string }[];
let controller: NavigationController;
let inspections: ReturnType<typeof gate<InspectedNavigationIdentity>>[];
let requests: Promise<unknown>[];
let opened: string[];
vi.mock("@/state/AppDataContext", () => ({ useOptionalAppData: () => ({ data: { materials } }) }));
vi.mock("@/state/navigation/useDocumentNavigation", () => ({ useNavigationController: () => {
  const owner = controller;
  const status = useSyncExternalStore(listener => owner.subscribe(listener), () => owner.status());
  return { controller: owner, status, repo: { canCheckFiles: () => true } };
} }));
function makeController(delivery?: ReturnType<typeof gate<void>>) {
  const owner = new NavigationController({
    inspect: async () => { const held = gate<InspectedNavigationIdentity>(); inspections.push(held); return held.promise; },
    open: async id => { opened.push(id); },
    operation: async () => { throw Error("guidance must not write"); },
  });
  const original = owner.openForGuidance.bind(owner);
  let calls = 0;
  owner.openForGuidance = (id, message, saved) => {
    const first = calls++ === 0;
    const pending = original(id, message, saved).then(async value => { if (first && delivery) await delivery.promise; return value; });
    requests.push(pending);
    return pending;
  };
  return owner;
}
beforeEach(() => { materials = [{ id: "m", filePath: "synthetic.pdf", title: "Current handbook" }]; inspections = []; requests = []; opened = []; controller = makeController(); });
afterEach(cleanup);
async function release(index: number, reject = false) {
  await act(async () => { if (reject) inspections[index]!.reject(new Error("retired inspection")); else inspections[index]!.resolve(identity); await requests[index]; });
}
it("retires a single pending source request on unmount", async () => {
  const view = render(h(SourcePageBadge, { materialId: "m", page: 5 }));
  fireEvent.click(screen.getByRole("button"));
  expect(inspections).toHaveLength(1);
  view.unmount(); await release(0);
  expect(opened).toEqual([]);
});
for (const rejection of [false, true]) it(`an old ${rejection ? "rejection" : "completion"} cannot erase the newer request's cleanup`, async () => {
  const view = render(h(SourcePageBadge, { materialId: "m", page: 5 }));
  fireEvent.click(screen.getByRole("button"));
  act(() => controller.abort());
  await waitFor(() => expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false));
  fireEvent.click(screen.getByRole("button"));
  expect(inspections).toHaveLength(2);
  await release(0, rejection);
  view.unmount(); await release(1);
  expect(opened).toEqual([]);
});
it("controller replacement with the same numeric epoch keeps distinct ownership", async () => {
  const view = render(h(SourcePageBadge, { materialId: "m", page: 5 }));
  fireEvent.click(screen.getByRole("button"));
  const first = controller;
  controller = makeController();
  view.rerender(h(SourcePageBadge, { materialId: "m", page: 5 }));
  fireEvent.click(screen.getByRole("button"));
  expect(first.status().epoch).toBeGreaterThan(1);
  expect(controller.status().epoch).toBe(1);
  await release(0);
  view.unmount(); await release(1);
  expect(opened).toEqual([]);
});
it("a delayed successful handler cannot clear a newer pending request", async () => {
  const delivery = gate<void>(); controller = makeController(delivery);
  const view = render(h(SourcePageBadge, { materialId: "m", page: 5 }));
  fireEvent.click(screen.getByRole("button"));
  await act(async () => { inspections[0]!.resolve(identity); });
  await waitFor(() => expect(opened).toEqual(["m"]));
  fireEvent.click(screen.getByRole("button"));
  expect(inspections).toHaveLength(2);
  await act(async () => { delivery.resolve(); await requests[0]; });
  view.unmount(); await release(1);
  expect(opened).toEqual(["m"]);
});
it("unmounting an older badge does not abort a request owned by another badge", async () => {
  const badges = (first: boolean) => h(Fragment, null,
    first ? h(SourcePageBadge, { key: "first", materialId: "m", page: 5 }) : null,
    h(SourcePageBadge, { key: "second", materialId: "m", page: 6 }));
  const view = render(badges(true));
  fireEvent.click(screen.getAllByRole("button")[0]!);
  act(() => controller.abort());
  fireEvent.click(screen.getAllByRole("button")[1]!);
  view.rerender(badges(false));
  await release(0); await release(1);
  expect(opened).toEqual(["m"]);
  expect(screen.getByRole("status").textContent).toContain("page 6");
});
it("changing the cited page retires the pending old intent", async () => {
  const view = render(h(SourcePageBadge, { materialId: "m", page: 5 }));
  fireEvent.click(screen.getByRole("button"));
  view.rerender(h(SourcePageBadge, { materialId: "m", page: 9 }));
  await release(0);
  expect(opened).toEqual([]);
  expect(screen.queryByRole("status")).toBeNull();
});
it("a live request opens and announces its own guidance", async () => {
  render(h(SourcePageBadge, { materialId: "m", page: 5 }));
  fireEvent.click(screen.getByRole("button")); await release(0);
  expect(opened).toEqual(["m"]);
  expect(screen.getByRole("status").textContent).toContain("page 5");
});
it("a replacement controller cannot display an old badge's notice at a colliding epoch", async () => {
  const view = render(h(SourcePageBadge, { materialId: "m", page: 5 }));
  fireEvent.click(screen.getByRole("button")); await release(0);
  controller = makeController();
  const unrelated = controller.openForGuidance("m", "Unrelated guidance");
  inspections[1]!.resolve(identity); await unrelated;
  view.rerender(h(SourcePageBadge, { materialId: "m", page: 5 }));
  expect(screen.queryByRole("status")).toBeNull();
});

it.each([
  ["Saved handbook", "Current handbook", "From: Saved handbook, page 5"],
  ["  ", "Current handbook", "From: Current handbook, page 5"],
  [null, "Current handbook", "From: Current handbook, page 5"],
  [undefined, "Current handbook", "Source page 5"],
  [undefined, undefined, "Source page 5"],
])("uses title fallbacks only when materialTitle is passed (%s)", (saved, current, label) => {
  materials = [{ id: "m", filePath: "synthetic.pdf", title: current }];
  render(h(SourcePageBadge, { materialId: "m", page: 5, materialTitle: saved }));
  expect(screen.getByText(label)).toBeTruthy();
  expect(screen.getAllByRole("button")).toHaveLength(1);
  expect(screen.getByRole("button", { name: `Open source: ${label}` }).textContent).toBe(label);
});
it.each([null, undefined, ""])("a missing page %s asks to check the source", page => {
  render(h(SourcePageBadge, { materialId: "m", materialTitle: "Handbook", page }));
  expect(screen.getByText("Check source")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
it.each([{ rows: [] }, { rows: [{ id: "m", title: "Current handbook", filePath: "" }] }])("keeps the saved title without a material/file", ({ rows }) => {
  materials = rows;
  render(h(SourcePageBadge, { materialId: "m", materialTitle: "Saved handbook", page: 5 }));
  expect(screen.getByText("From: Saved handbook, page 5")).toBeTruthy();
  expect(screen.queryByRole("button")).toBeNull();
});
it("retiring the material during inspection cannot open the old source", async () => {
  const view = render(h(SourcePageBadge, { materialId: "m", page: 5 }));
  fireEvent.click(screen.getByRole("button"));
  view.rerender(h(SourcePageBadge, { materialId: null, page: 5 }));
  await release(0);
  expect(opened).toEqual([]);
});

it("keeps keyboard focus while busy and ignores repeated activation", async () => {
  render(h(SourcePageBadge, { materialId: "m", page: 5 }));
  const source = screen.getByRole("button");
  source.focus();
  fireEvent.click(source, { detail: 0 });
  expect(source.getAttribute("aria-disabled")).toBe("true");
  expect((source as HTMLButtonElement).disabled).toBe(false);
  expect(document.activeElement).toBe(source);
  fireEvent.click(source, { detail: 0 });
  expect(inspections).toHaveLength(1);
  await release(0);
  expect(source.getAttribute("aria-disabled")).toBe("false");
  expect(document.activeElement).toBe(source);
  expect(opened).toEqual(["m"]);
});

const savedPageSource = {
  id: "saved-source", materialId: "m", materialTitle: "Saved handbook title",
  contentSha256: "a".repeat(64), physicalPage: 5, printedLabel: "iv",
};
it("a saved page source keeps its physical/printed labels when its material is missing, with no extra controls", async () => {
  materials = [];
  render(h(SourcePageBadge, {materialId: "m", page: 5, source: savedPageSource}));
  expect(await screen.findByText("Source page 5 (printed page iv) · Position unverified")).toBeTruthy();
  expect(screen.queryByRole("button", {name: /Open source:/})).toBeNull();
  expect(screen.queryByRole("button", {name: "Copy page"})).toBeNull();
  expect(opened).toEqual([]);
  expect(inspections).toEqual([]);
});
it("a changed saved source never opens the replacement and calmly remains unverified", async () => {
  render(h(SourcePageBadge, {materialId: "m", page: 5, source: {...savedPageSource, contentSha256: "b".repeat(64)}}));
  fireEvent.click(screen.getByRole("button", {name: /Open source:/}));
  await release(0);
  expect(opened).toEqual([]);
  expect(screen.getByRole("button", {name: /Source page 5 \(printed page iv\).*Position unverified/})).toBeTruthy();
});

it("changing the saved source retires an inspection even when material and page stay the same", async () => {
  const view=render(h(SourcePageBadge,{materialId:"m",page:5,source:savedPageSource}));
  fireEvent.click(screen.getByRole("button",{name:/Open source:/}));
  view.rerender(h(SourcePageBadge,{materialId:"m",page:5,source:{...savedPageSource,id:"replacement-source",contentSha256:"b".repeat(64)}}));
  await release(0);
  expect(opened).toEqual([]);
  expect(controller.status().kind).toBe("idle");
});

it("a restored matching file becomes verified after its original hash and page are checked on open", async () => {
  render(h(SourcePageBadge,{materialId:"m",page:5,source:savedPageSource}));
  // While the file is still being checked the badge claims nothing either way.
  expect(screen.queryByRole("button",{name:/Position unverified/})).toBeNull();
  fireEvent.click(screen.getByRole("button",{name:/Open source:/}));
  await release(0);
  expect(opened).toEqual(["m"]);
  expect(screen.getByRole("button",{name:"Open source: Source page 5 (printed page iv)"})).toBeTruthy();
});
