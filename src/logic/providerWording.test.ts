import { expect, it } from "vitest";
import { providerCompany, providerWording, CLAUDE_PRIVACY } from "@/services/provider";
import { geminiModelName } from "@/services/gemini";
import { checkAiSubmission, geminiSendDisclosure } from "./aiSafety";
import type { StudyMaterial } from "@/domain/types";
const material = { title:"Fictional wing", originalFileName:"fictional.pdf", filePath:"documents/fictional.pdf", materialType:"study_guide" } as StudyMaterial;
it("labels Claude and preserves historical model labels",()=>{
  expect(geminiModelName("claude-haiku-5-5")).toBe("Claude Haiku 5.5");
  expect(geminiModelName("gemini-3.8-flash")).toBe("Gemini 3.8 Flash");
  expect(geminiModelName("gemini-4-argon")).toBe("Gemini 4 Argon");
  const kept = "This draft was started with Gemini. Use Gemini in Settings to continue it.";
  expect(providerWording(kept, "claude-haiku-5-5")).toBe(kept);
});
it("names Anthropic and its retention in the send confirmation",()=>{
  const company=providerCompany("claude-haiku-5-5");
  expect(`Send this file to ${company}?`).toBe("Send this file to Anthropic?");
  const reason=checkAiSubmission(material,[],"file",company).reason;
  expect(reason).toContain("sent to Anthropic"); expect(reason).not.toMatch(/Google|48 hours|free tier/);
  expect(geminiSendDisclosure(material,company)).toContain(CLAUDE_PRIVACY);
  expect(geminiSendDisclosure(material,company)).not.toContain("Google");
});

it("has explicit Claude messages without Gemini or Google instructions", async()=>{
  const {CLAUDE_MESSAGES}=await import("@/services/providerMessages");
  expect(Object.keys(CLAUDE_MESSAGES).length).toBeGreaterThan(20);
  for(const message of Object.values(CLAUDE_MESSAGES)) expect(message).not.toMatch(/Gemini|Google|billing|free tier|Flash/);
});
it("preserves filenames and user text containing Google and Gemini",()=>{
  const file="Google Earth for pilots.pdf";
  expect(providerWording(`Could not read ${file}`,"claude-haiku-5-5")).toBe(`Could not read ${file}`);
  expect(providerWording("My Google and Gemini notes", "claude-haiku-5-5")).toBe("My Google and Gemini notes");
  const source={...material,originalFileName:file};
  expect(geminiSendDisclosure(source,"Anthropic")).toContain(file);
  expect(checkAiSubmission(source,[],"file","Anthropic").reason).toContain(file);
});

it("writes unsupported-file advice for the selected provider",async()=>{
  const {checkFileForGemini}=await import("./aiLimits");
  const verdict=checkFileForGemini("Google Earth for pilots.docx",100,"Claude");
  expect(verdict.ready).toBe(false);
  if(!verdict.ready) { expect(verdict.reason).toContain("Claude study tools"); expect(verdict.reason).not.toMatch(/Gemini|Google/); }
});
