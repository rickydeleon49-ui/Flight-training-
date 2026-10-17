// @vitest-environment jsdom
import {createElement as h,useSyncExternalStore} from "react";
import {act,cleanup,fireEvent,render,screen,waitFor} from "@testing-library/react";
import {afterEach,beforeEach,it,expect,vi} from "vitest";
import {NavigationController} from "@/state/navigation/controller";
import {SourcePageBadge} from "./SourcePageBadge";
const A="a".repeat(64);
function gate(){let resolve!:(v:any)=>void;const promise=new Promise<any>(r=>resolve=r);return {promise,resolve};}
let controller:NavigationController;
let holds:ReturnType<typeof gate>[];
let requests:Promise<unknown>[];
let opened:string[];
let inspections=0;
vi.mock("@/state/AppDataContext",()=>({useOptionalAppData:()=>({data:{materials:[{id:"m",filePath:"synthetic.pdf"}]}})}));
vi.mock("@/state/navigation/useDocumentNavigation",()=>({useNavigationController:()=>{
 const status=useSyncExternalStore(l=>controller.subscribe(l),()=>controller.status());
 return {controller,status,repo:{canCheckFiles:()=>true}};
}}));
beforeEach(()=>{
 holds=[gate(),gate()];opened=[];requests=[];inspections=0;
 controller=new NavigationController({inspect:async()=>holds[inspections++]!.promise,open:async(id)=>{opened.push(id);},operation:async()=>{throw Error("guidance must not write");}});
 const original=controller.openForGuidance.bind(controller);
 controller.openForGuidance=(id,message)=>{const p=original(id,message);requests.push(p);return p;};
});
afterEach(cleanup);
const identity={materialId:"m",contentSha256:A,totalPages:50,verifiedAt:"x",changed:false};
it("[control] a single source request is retired on badge unmount",async()=>{
 const view=render(h(SourcePageBadge,{materialId:"m",page:5}));
 fireEvent.click(screen.getByRole("button"));
 expect(inspections).toBe(1);view.unmount();
 await act(async()=>{holds[0]!.resolve(identity);await requests[0];});
 expect(opened).toEqual([]);
});
it("[R12] an older completion cannot erase a newer source request's unmount ownership",async()=>{
 const view=render(h(SourcePageBadge,{materialId:"m",page:5}));
 fireEvent.click(screen.getByRole("button"));
 act(()=>controller.abort());
 await waitFor(()=>expect((screen.getByRole("button") as HTMLButtonElement).disabled).toBe(false));
 fireEvent.click(screen.getByRole("button"));
 expect(inspections).toBe(2);
 await act(async()=>{holds[0]!.resolve(identity);await requests[0];});
 view.unmount();
 await act(async()=>{holds[1]!.resolve(identity);await requests[1];});
 expect(opened,"unmount must still retire the newer held request").toEqual([]);
});
