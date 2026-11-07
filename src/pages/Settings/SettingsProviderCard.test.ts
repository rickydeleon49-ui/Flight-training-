// @vitest-environment jsdom
import { createElement as h } from "react";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { ProviderControls } from "./ProviderControls";
import * as provider from "@/services/provider";
const mocks = vi.hoisted(() => ({ openUrl: vi.fn() }));
vi.mock("@/data", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/plugin-opener", () => ({ openUrl: mocks.openUrl }));
const status = (selected: provider.ProviderId, connected = false): provider.ProviderStatus => ({ selected, providers: [{ id: "gemini", connected: true }, { id: "claude", connected }] });
function open() {
  return render(h(ProviderControls, { children: h("fieldset", null,
    h("legend", null, "Model for new study aids"), h("label", null, h("input", {type:"radio", name:"model"}), "Standard"), h("label", null, h("input", {type:"radio", name:"model"}), "Most capable"), h("p", null, "Gemini setup unchanged")) }));
}
beforeEach(() => { vi.spyOn(provider,"providerStatus").mockResolvedValue(status("gemini")); });
afterEach(() => { cleanup(); vi.restoreAllMocks(); });
it("keeps Gemini content and closes the quiet disclosure by default", async () => {
  const { container } = open();
  await waitFor(() => expect(provider.providerStatus).toHaveBeenCalled());
  expect(screen.getByText("Gemini setup unchanged")).toBeTruthy();
  expect(screen.getByRole("radio",{ name:"Standard" })).toBeTruthy();
  expect(container.querySelector("details")!.open).toBe(false);
  expect(screen.getByText("Use a different provider")).toBeTruthy();
});
it("clears the key on submission, connects then switches without deleting anything", async () => {
  let state = status("gemini");
  vi.mocked(provider.providerStatus).mockImplementation(async()=>state);
  const connect = vi.spyOn(provider,"configureProvider").mockImplementation(async()=> { state=status("claude",true); return state; });
  const choose = vi.spyOn(provider,"selectProvider").mockImplementation(async(id)=> { state=status(id,true); });
  const disconnect = vi.spyOn(provider,"disconnectProvider");
  const { container } = open();
  container.querySelector("details")!.open=true;
  fireEvent.change(screen.getByLabelText("Claude API key"),{target:{value:"synthetic-claude-key-only"}});
  fireEvent.click(screen.getByRole("button",{name:"Connect Claude"}));
  expect((screen.getByLabelText("Claude API key") as HTMLInputElement).value).toBe("");
  await screen.findByText("Claude is connected and will be used for your study tools. Your saved study material is kept.");
  expect(connect).toHaveBeenCalledWith("claude","synthetic-claude-key-only");
  await screen.findByText(/Claude Haiku 5.5 · Ready to use/);
  expect(container.querySelector("details")!.open).toBe(false);
  expect(container.querySelector("details")!.textContent).toContain("Gemini setup unchanged");
  expect(screen.getByRole("button",{name:"Disconnect Claude"}).closest("details")).toBeNull();
  expect(screen.getAllByRole("radio").every(input => input.closest("details") === container.querySelector("details"))).toBe(true);
  container.querySelector("details")!.open=true;
  fireEvent.click(screen.getByRole("button",{name:"Use Gemini"}));
  await screen.findByRole("radio",{name:"Most capable"});
  expect(choose).toHaveBeenLastCalledWith("gemini");
  expect(disconnect).not.toHaveBeenCalled();
});
it("clears a rejected key and shows the safe connection error", async () => {
  vi.spyOn(provider,"configureProvider").mockRejectedValue("Claude didn't accept this key. Check it in Settings.");
  const { container } = open(); container.querySelector("details")!.open=true;
  fireEvent.change(screen.getByLabelText("Claude API key"),{target:{value:"synthetic-rejected-key-only"}});
  fireEvent.click(screen.getByRole("button",{name:"Connect Claude"}));
  await screen.findByRole("alert");
  expect((screen.getByLabelText("Claude API key") as HTMLInputElement).value).toBe("");
});
it("disconnects Claude and restores Gemini study tools", async () => {
  vi.mocked(provider.providerStatus).mockResolvedValue(status("claude",true));
  const disconnect=vi.spyOn(provider,"disconnectProvider").mockResolvedValue(status("gemini",false));
  const {container}=open(); container.querySelector("details")!.open=true;
  fireEvent.click(await screen.findByRole("button",{name:"Disconnect Claude"}));
  await screen.findByText("Claude disconnected. Study tools use Gemini again. Your saved study material is kept.");
  expect(disconnect).toHaveBeenCalledWith("claude");
  expect(screen.getByRole("radio",{name:"Standard"})).toBeTruthy();
});
it("opens the verified Anthropic key page", async()=>{
  const {container}=open(); container.querySelector("details")!.open=true;
  fireEvent.click(screen.getByRole("link",{name:"Get a key"}));
  await waitFor(()=>expect(mocks.openUrl).toHaveBeenCalledWith("https://platform.claude.com/settings/keys"));
});

it("reports the selected Claude connection to the Settings header when Gemini is disconnected", async () => {
  vi.mocked(provider.providerStatus).mockResolvedValue({selected:"claude",providers:[{id:"gemini",connected:false},{id:"claude",connected:true}]});
  const onStatus=vi.fn();
  render(h(ProviderControls,{children:h("p",null,"Gemini"),onStatus}));
  await waitFor(()=>expect(onStatus).toHaveBeenLastCalledWith({selected:"claude",providers:[{id:"gemini",connected:false},{id:"claude",connected:true}]}));
});
it("reports the selected Gemini connection even when only Claude is connected", async () => {
  vi.mocked(provider.providerStatus).mockResolvedValue({selected:"gemini",providers:[{id:"gemini",connected:false},{id:"claude",connected:true}]});
  const onStatus=vi.fn();
  render(h(ProviderControls,{children:h("p",null,"Gemini"),onStatus}));
  await waitFor(()=>expect(provider.providerStatus).toHaveBeenCalled());
  await waitFor(()=>expect(onStatus).toHaveBeenLastCalledWith({selected:"gemini",providers:[{id:"gemini",connected:false},{id:"claude",connected:true}]}));
});
it("BUGFIX-064: Claude chosen but its key is missing shows the key box and keeps Use Gemini", async () => {
  vi.mocked(provider.providerStatus).mockResolvedValue(status("claude", false));
  const connect = vi.spyOn(provider, "configureProvider").mockResolvedValue(status("claude", true));
  const { container } = open();
  await screen.findByText(/Claude Haiku 5.5 · Connect Claude to use study tools/);
  expect(screen.queryByRole("button", { name: "Disconnect Claude" })).toBeNull();
  const input = screen.getByLabelText("Claude API key");
  expect(input.closest("details")).toBeNull();
  fireEvent.change(input, { target: { value: "synthetic-claude-key-only" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect Claude" }));
  await screen.findByText(/Claude Haiku 5.5 · Ready to use/);
  expect(connect).toHaveBeenCalledWith("claude", "synthetic-claude-key-only");
  container.querySelector("details")!.open = true;
  expect(screen.getByRole("button", { name: "Use Gemini" })).toBeTruthy();
});

it("shows the adult and own-key requirement beside AI setup", () => {
  open();
  expect(screen.getByText("You need to be 18 or older and use your own API key. Your use of the AI service follows that company's terms.")).toBeTruthy();
});
it("dates Claude's privacy summary and opens its official terms with Tauri", async () => {
  const { container } = open();
  container.querySelector("details")!.open = true;
  const link = screen.getByRole("link", { name: "Anthropic's terms" });
  expect(link.getAttribute("href")).toBe("https://www.anthropic.com/legal/commercial-terms");
  expect(link.closest("p")!.textContent).toContain("(as of Nov 2026; see Anthropic's terms)");
  fireEvent.click(link);
  await waitFor(() => expect(mocks.openUrl).toHaveBeenCalledWith("https://www.anthropic.com/legal/commercial-terms"));
});

it.each(["gemini", "claude"] as const)("shows an unreadable Claude key without offering replacement (selected: %s)", async (selected) => {
  vi.mocked(provider.providerStatus).mockResolvedValue({selected,providers:[
    {id:"gemini",connected:false}, {id:"claude",connected:false,keyUnreadable:true}
  ]});
  open();
  await screen.findByText(provider.SAVED_KEY_UNREADABLE);
  expect(screen.queryByLabelText("Claude API key")).toBeNull();
  expect(screen.queryByRole("button", {name:"Connect Claude"})).toBeNull();
  expect(screen.queryByText(/Connect Claude to use study tools/)).toBeNull();
});
it("offers one plain Try again when the saved key can't be read, and keeps the key", async () => {
  const bad: provider.ProviderStatus = { selected: "claude", providers: [{ id: "gemini", connected: false }, { id: "claude", connected: false, keyUnreadable: true }] };
  vi.mocked(provider.providerStatus).mockResolvedValue(bad);
  const retry = vi.spyOn(provider, "retryKeyAccess").mockResolvedValue(status("claude", true));
  const disconnect = vi.spyOn(provider, "disconnectProvider");
  open();
  const again = await screen.findByRole("button", { name: "Try again" });
  expect(screen.getByText(provider.SAVED_KEY_UNREADABLE)).toBeTruthy();
  fireEvent.click(again);
  await waitFor(() => expect(retry).toHaveBeenCalledTimes(1));
  await screen.findByText(/Ready to use/);
  expect(screen.queryByRole("button", { name: "Try again" })).toBeNull();
  expect(disconnect).not.toHaveBeenCalled();
});

it("lets Claude's two models be chosen and names each", async () => {
  const { geminiModelName, CLAUDE_MODEL_CHOICES } = await import("@/services/gemini");
  expect(CLAUDE_MODEL_CHOICES.standard.label).toBe("Standard — Claude Haiku 5.5");
  expect(CLAUDE_MODEL_CHOICES["most-capable"].label).toBe("Most capable — Claude Sonnet 5.5");
  expect(geminiModelName("claude-sonnet-5-5")).toBe("Claude Sonnet 5.5");
  expect(geminiModelName("claude-haiku-5-5")).toBe("Claude Haiku 5.5");
});
