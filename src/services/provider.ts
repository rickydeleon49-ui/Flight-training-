import { CLAUDE_MESSAGES } from "./providerMessages";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/data";
import { DesktopOnlyError } from "./documents";

export type ProviderId = "gemini" | "claude";
export interface ProviderStatus {
  selected: ProviderId;
  providers: { id: ProviderId; connected: boolean }[];
}

/** Native key-presence status only; no keys cross this boundary. */
export async function providerStatus(): Promise<ProviderStatus> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<ProviderStatus>("provider_status");
}

/** Switching leaves saved keys and study material in place. */
export async function selectProvider(id: ProviderId): Promise<void> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<void>("select_provider", { id });
}

export async function configureProvider(id: ProviderId, apiKey: string): Promise<ProviderStatus> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<ProviderStatus>("configure_provider", { id, apiKey });
}
export async function disconnectProvider(id: ProviderId): Promise<ProviderStatus> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<ProviderStatus>("disconnect_provider", { id });
}
export const CLAUDE_KEY_URL = "https://platform.claude.com/settings/keys";
export const CLAUDE_PRIVACY = "Anthropic: your files are not used for training and are deleted within 30 days.";
export const providerCompany = (model?: string): "Anthropic" | "Google" => model?.startsWith("claude-") ? "Anthropic" : "Google";

/** Only complete, fixed app messages have provider variants. Never edit arbitrary text. */
export function providerWording(text: string, model?: string): string {
  return providerCompany(model) === "Anthropic" ? CLAUDE_MESSAGES[text] ?? text : text;
}
