// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import type { HomeworkOperation } from "@/domain/homework";
import type { CardReviewRepository } from "@/data/repositories/cardReviewRepository";
import { cardVersion } from "@/logic/cardIdentity";
import { HomeworkCardRun } from "./HomeworkCardRun";
const F = JSON.parse(readFileSync("src-tauri/fixtures/homework-validation/cases.json", "utf8")) as { operations:Record<string,HomeworkOperation> };
afterEach(cleanup);
async function setup(key="card_create",empty=false) {
  const snapshot=structuredClone(F.operations[key]!.next),entry=snapshot.activities[0]!;
  const current=await cardVersion(entry.record.material_id!,[{front:"One",back:"First",sourcePage:null},{front:"Two",back:"Second",sourcePage:null}]);
  const getDueQueue=vi.fn(async()=>empty?[]:current.items.map(item=>({itemId:item.itemId,ordinal:item.ordinal,kind:"new",dueAt:null})));
  const saveAction=vi.fn(async(_action:import("@/domain/types").CardReviewAction)=>({}));const save=vi.fn(async(_op:HomeworkOperation)=>{}),reload=vi.fn(),reopen=vi.fn();
  const repository={getCardReviewSnapshot:async()=>({materialId:entry.record.material_id,generation:0,current:{status:"ok",...current},states:{}}),getDueQueue,saveAction} as unknown as CardReviewRepository;
  render(h(HomeworkCardRun,{snapshot,entry,repository,disabled:false,save,reload,reopen}));
  return {snapshot,current,getDueQueue,saveAction,save,reload,reopen};
}
it("previews and freezes the bounded linked queue before Start",async()=>{
  const {save,current}=await setup();
  await screen.findByText("Review 2 linked cards");
  fireEvent.click(screen.getByRole("button",{name:"Start card review"}));
  await waitFor(()=>expect(save).toHaveBeenCalledTimes(1));
  const op=save.mock.calls[0]![0];
  expect(op.changeKind).toBe("start");expect(op.next.runs[0]!.scope.item_ids).toEqual(current.items.map(x=>x.itemId));
  expect(op.next.runs[0]!.scope.generation).toBe(0);expect(op.next.runs[0]!.ratings).toEqual([]);
});
it("restart resumes the frozen queue even when no cards are due now",async()=>{
  await setup("card_partial",true);
  await screen.findByText("Two");expect(screen.getByText("1 of 2 linked cards rated")).toBeTruthy();
  expect(screen.queryByText("One")).toBeNull();expect(screen.queryByRole("button",{name:"Start card review"})).toBeNull();
});
it("rating has exact homework attribution and unknown retries reuse its operation",async()=>{
  const {saveAction,reload,snapshot}=await setup("card_partial");
  saveAction.mockRejectedValueOnce(new Error("synthetic storage failure"));
  fireEvent.click(await screen.findByRole("button",{name:"Show answer"}));
  fireEvent.click(await screen.findByRole("button",{name:"Again"}));
  fireEvent.click(await screen.findByRole("button",{name:"Retry rating"}));
  await waitFor(()=>expect(saveAction).toHaveBeenCalledTimes(2));
  expect(saveAction.mock.calls[0]).toEqual(saveAction.mock.calls[1]);
  expect(saveAction.mock.calls[0]![0]).toMatchObject({homework:{assignmentId:snapshot.assignment.id,runId:snapshot.runs[0]!.id,expectedRevision:3,activityRevision:1,cycle:1}});
  await waitFor(()=>expect(reload).toHaveBeenCalledTimes(1));
});
it("empty queues cannot start or complete homework",async()=>{
  await setup("card_create",true);
  // The component awaits its snapshot before asking for the queue.
  await screen.findByText("No linked cards are due or new just now.");
  expect((screen.getByRole("button",{name:"Start card review"}) as HTMLButtonElement).disabled).toBe(true);
});
