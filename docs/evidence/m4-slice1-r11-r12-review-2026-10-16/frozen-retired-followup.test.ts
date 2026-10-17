// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { useMaterialNavigation } from "./useDocumentNavigation";
const A="a".repeat(64),B="b".repeat(64);
const gate=()=>{let resolve!:()=>void;const promise=new Promise<void>(r=>resolve=r);return {promise,resolve};};
const state=(hash:string)=>({materialId:"m",identity:{materialId:"m",contentSha256:hash,totalPages:50,verifiedAt:"x"},readingState:null,bookmarks:[]});
const IDLE={kind:"idle" as const,epoch:0};
afterEach(cleanup);
it.each(["checkPages","deleteBookmark"] as const)("[R11] a retired %s completion cannot start an old-repository read",async(action)=>{
 const held=gate();let upstreamStarted=false;
 const oldRepo:any={supported:()=>true,inspect:async()=>{upstreamStarted=true;await held.promise;return {...state(A).identity,changed:false};},operation:async(op:any)=>{if(op.kind==="read")return state(A);upstreamStarted=true;await held.promise;return {deleted:true};}};
 const newRepo:any={supported:()=>true,operation:async()=>state(B)};
 const {result,rerender}=renderHook(({repo})=>useMaterialNavigation("m",repo,IDLE),{initialProps:{repo:oldRepo}});
 await waitFor(()=>expect(result.current.state?.identity?.contentSha256).toBe(A));
 let older!:Promise<unknown>;
 act(()=>{older=action==="checkPages"?result.current.checkPages():result.current.deleteBookmark("old");});
 expect(upstreamStarted).toBe(true);
 rerender({repo:newRepo});
 await waitFor(()=>expect(result.current.state?.identity?.contentSha256).toBe(B));
 await act(async()=>{held.resolve();await older;});
 expect(result.current.state?.identity?.contentSha256,"an old operation's finally must not resurrect its repository").toBe(B);
});
