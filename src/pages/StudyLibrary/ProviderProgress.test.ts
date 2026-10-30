// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { GeminiErrorText, GeminiProgressView, GeminiJobNotice } from "./GeminiJobNotice";
import type { GeminiJob, useGeminiJobs } from "@/state/GeminiJobs";
afterEach(cleanup);
it("names Claude in busy progress and existing fixed error wording",()=>{
  const job={phase:"running",stage:"generating",attempt:2,progress:null,answer:null} as GeminiJob;
  render(h(GeminiProgressView,{job,title:"Gemini is reviewing this document",model:"claude-haiku-5-5",onCancel:vi.fn()}));
  expect(screen.getByText("Claude is reviewing this document")).toBeTruthy();
  expect(screen.getByText("Claude is busy — trying again")).toBeTruthy();
  expect(document.body.textContent).not.toContain("Gemini");
});
it("uses the stored answering model ahead of the current provider",()=>{
  const job={phase:"saving",stage:"validating",answer:{model:"gemini-3.8-flash"}} as GeminiJob;
  render(h(GeminiProgressView,{job,title:"Gemini is reviewing this document",model:"claude-haiku-5-5",onCancel:vi.fn()}));
  expect(screen.getByText("Gemini is reviewing this document")).toBeTruthy();
});
it("names Claude in local errors without exposing Details by default",()=>{
  render(h(GeminiErrorText,{model:"claude-haiku-5-5",message:"Gemini is already working. Wait for it to finish."}));
  expect(screen.getByRole("alert").textContent).toBe("Claude is already working. Wait for it to finish.");
});

it("shows the native draft-owner reason when a queued guide runs under another provider",()=>{
  const message="This draft was started with Gemini. Use Gemini in Settings to continue it, or discard it and start a new one. Your finished work is kept.";
  const job={key:"fictional",materialId:"fictional",kind:"study-aid",phase:"failed",sectionGuide:true,sectionError:"GUIDE_FAILED",error:message,local:true,sections:{ready:0,model:"gemini-3.5-flash"}} as GeminiJob;
  const jobs={jobs:[job],busy:false,locked:()=>false} as ReturnType<typeof useGeminiJobs>;
  render(h(GeminiJobNotice,{job,jobs,model:"claude-haiku-5-5"}));
  expect(screen.getByText(message)).toBeTruthy();
});
