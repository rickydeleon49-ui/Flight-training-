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

/** Native code rejects providers that cannot send requests yet. */
export async function selectProvider(id: ProviderId): Promise<void> {
  if (!isTauri()) throw new DesktopOnlyError();
  return invoke<void>("select_provider", { id });
}
