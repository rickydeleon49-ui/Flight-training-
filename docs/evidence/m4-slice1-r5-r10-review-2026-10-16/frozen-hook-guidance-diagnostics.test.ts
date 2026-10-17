// @vitest-environment jsdom
import {act,cleanup,renderHook,waitFor} from "@testing-library/react";
import {afterEach,it,expect} from "vitest";
import {useMaterialNavigation,navigationControllerFor} from "./useDocumentNavigation";
const A="a".repeat(64), B="b".repeat(64);
const gate=()=>{let resolve!: (x:any)=>void; const promise=new Promise<any>(r=>resolve=r); return {promise,resolve};};
const state=(hash:string)=>({materialId:"m",identity:{materialId:"m",contentSha256:hash,totalPages:50,verifiedAt:"x"},readingState:null,bookmarks:[]});
afterEach(cleanup);
it("[R7] an older material reload cannot overwrite newer content state",async()=>{
 const first=gate(); let calls=0;
 const repo:any={supported:()=>true,operation:()=>++calls===1?first.promise:Promise.resolve(state(B))};
 const result=renderHook(()=>useMaterialNavigation("m",repo,{kind:"idle",epoch:0}));
 await waitFor(()=>expect(calls).toBe(1));
 await act(async()=>{await result.result.current.reload();});
 expect(result.result.current.state?.identity?.contentSha256).toBe(B);
 await act(async()=>{first.resolve(state(A));await first.promise;});
 expect(result.result.current.state?.identity?.contentSha256,"late A must not replace B").toBe(B);
});
it("[R8] a superseded guidance inspection must not launch its old document",async()=>{
 const first=gate();const opened:string[]=[];
 const repo:any={inspect:async(id:string)=>id==="m1"?first.promise:{materialId:id,contentSha256:B,totalPages:5,verifiedAt:"x",changed:false},open:async(id:string)=>{opened.push(id);},operation:async()=>{throw Error("guidance must not write");}};
 const controller=navigationControllerFor(repo);
 const older=controller.openForGuidance("m1","A");
 await controller.openForGuidance("m2","B");
 first.resolve({materialId:"m1",contentSha256:A,totalPages:5,verifiedAt:"x",changed:false});
 expect(await older).toBeNull();
 expect(opened,"retired guidance A must not open after B").toEqual(["m2"]);
});
