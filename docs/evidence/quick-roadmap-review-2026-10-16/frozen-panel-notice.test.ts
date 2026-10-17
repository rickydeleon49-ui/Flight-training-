// @vitest-environment jsdom
import { createElement as h } from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import type { NavigationRepository } from "@/data/repositories/navigationRepository";
import type { InspectedNavigationIdentity, NavigationState } from "@/domain/types";
import { NavigationError } from "@/data/navigationTransaction";
import { makeMaterial } from "@/testing/factories";
import { DocumentPagesPanel } from "./DocumentPagesPanel";
let current: NavigationRepository;
vi.mock("@/state/AppDataContext",()=>({useOptionalAppData:()=>({repositories:{navigation:current}})}));
const material=makeMaterial({id:"m",filePath:"synthetic.pdf"});
const props={material,fileMissing:false,restoring:false,onRestore:()=>{}};
const state=(totalPages:number):NavigationState=>({materialId:"m",identity:{materialId:"m",contentSha256:(totalPages===50?"a":"b").repeat(64),totalPages,verifiedAt:"x"},readingState:null,bookmarks:[]});
function gate(){let resolve!:(value:InspectedNavigationIdentity)=>void,reject!:(reason:unknown)=>void;const promise=new Promise<InspectedNavigationIdentity>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
const repo=(totalPages:number,held:ReturnType<typeof gate>)=>({supported:()=>true,canCheckFiles:()=>true,inspect:()=>held.promise,operation:async()=>state(totalPages)})as unknown as NavigationRepository;
afterEach(cleanup);
it.each(["success","failure"]as const)("a retired check's %s must not announce an old-context notice",async(outcome)=>{
 const old=gate(),next=gate();current=repo(50,old);
 const view=render(h(DocumentPagesPanel,props));
 await screen.findByText("This PDF has 50 pages.");
 fireEvent.click(screen.getByRole("button",{name:"Check pages"}));
 current=repo(70,next);view.rerender(h(DocumentPagesPanel,props));
 await screen.findByText("This PDF has 70 pages.");
 await act(async()=>{if(outcome==="success")old.resolve({...state(50).identity!,changed:true});else old.reject(new NavigationError("FILE_MISSING","Synthetic old-context file missing"));});
 await waitFor(()=>expect(screen.getByText("This PDF has 70 pages.")).toBeTruthy());
 expect(screen.queryByText(/This file changed since it was last checked|Synthetic old-context file missing/)).toBeNull();
});
