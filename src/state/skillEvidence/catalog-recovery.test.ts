// @vitest-environment jsdom
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { SkillEvidenceAction } from "@/domain/types";
import { useSkillList } from "@/state/useSkillList";

const { context } = vi.hoisted(() => ({ context: { repositories: null as unknown, dataRevision: 0 } }));
vi.mock("@/state/AppDataContext", () => ({ useAppData: () => context }));
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const build = (label: string) => (operationId: string): SkillEvidenceAction => ({
  action: "create_custom_skill", operationId, skillId: `custom.${crypto.randomUUID()}`, label, description: "", topic: "general",
});
function setup(write: (a: SkillEvidenceAction) => Promise<unknown>) {
  const skills = vi.fn(async () => []);
  context.repositories = { skillEvidence: { skills, act: write } };
  return { ...renderHook(() => useSkillList()), skills };
}
it("catalog same-turn double submission joins one request", async () => {
  let resolve!: (v: unknown) => void;
  const write = vi.fn(() => new Promise(r => { resolve = r; }));
  const hook = setup(write);
  let one!: Promise<unknown>, two!: Promise<unknown>;
  act(() => {
    one = hook.result.current.act("create", { label: "First" }, build("First"));
    two = hook.result.current.act("create", { label: "First" }, build("First"));
  });
  expect(write).toHaveBeenCalledTimes(1);
  await act(async () => { resolve({}); await Promise.all([one, two]); });
});
it("catalog changed draft first resolves its unknown create and does not mint a second skill", async () => {
  const sent: SkillEvidenceAction[] = [];
  const write = vi.fn(async (request: SkillEvidenceAction) => {
    sent.push(request);
    if (sent.length === 1) throw new Error("Lost acknowledgment after commit");
    return {};
  });
  const hook = setup(write);
  await act(async () => {
    expect(await hook.result.current.act("create", { label: "First" }, build("First"))).toMatchObject({ kind: "unknown" });
    expect(await hook.result.current.act("create", { label: "Changed" }, build("Changed"))).toMatchObject({ kind: "earlier_done" });
  });
  expect(sent[1]).toEqual(sent[0]);
});
it("a catalog acknowledgment after unmount performs no refresh", async () => {
  let resolve!: (v: unknown) => void;
  const hook = setup(() => new Promise(r => { resolve = r; }));
  let pending!: Promise<unknown>;
  act(() => { pending = hook.result.current.act("create", { label: "First" }, build("First")); });
  const reads = hook.skills.mock.calls.length;
  hook.unmount();
  await act(async () => { resolve({}); await pending; });
  expect(hook.skills).toHaveBeenCalledTimes(reads);
});
