import { useEffect, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/data";
import { Button, TextInput } from "@/components/ui";
import { CLAUDE_KEY_URL, CLAUDE_PRIVACY, configureProvider, disconnectProvider, providerStatus, selectProvider, type ProviderId, type ProviderStatus } from "@/services/provider";

export function ProviderControls({ children, onStatus }: { children: ReactNode; onStatus?: (status: ProviderStatus) => void }) {
  const [status, setStatus] = useState<ProviderStatus>({ selected: "gemini", providers: [] });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  useEffect(() => {
    if (isTauri()) void providerStatus().then(setStatus).catch(() => { setProblem(true); setNote("Could not check your AI connections. Reopen Settings to try again."); });
  }, []);
  useEffect(() => { onStatus?.(status); }, [status, onStatus]);
  const connected = status.providers.some((p) => p.id === "claude" && p.connected);
  async function run(work: () => Promise<void>) {
    setBusy(true); setProblem(false); setNote(null);
    try { await work(); }
    catch (error) { setProblem(true); setNote(typeof error === "string" ? error : "Could not save this change. Try again."); }
    finally { setBusy(false); }
  }
  async function choose(id: ProviderId) {
    await selectProvider(id);
    setStatus(await providerStatus());
    setNote(`New study aids will use ${id === "claude" ? "Claude Haiku 5.5" : "Gemini"}. Your saved study material is kept.`);
  }
  return <div className="stack stack--4">
    {status.selected === "gemini" ? children : <div className="stack stack--2">
      <p className="small strong">Claude Haiku 5.5 · {connected ? "Ready to use" : "Connect Claude to use study tools"}</p>
      <p className="tiny dim">{CLAUDE_PRIVACY}</p>
      <div><Button disabled={busy} onClick={() => void run(() => choose("gemini"))}>Use Gemini</Button></div>
    </div>}
    <details>
      <summary className="small">Use a different provider</summary>
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <p className="small strong">Claude (Anthropic)</p>
        <p className="tiny dim">{CLAUDE_PRIVACY}</p>
        <p className="tiny dim">Your key stays on this computer and is not included in backups.</p>
        <div><a className="small" href={CLAUDE_KEY_URL} target="_blank" rel="noopener noreferrer" onClick={(event) => {
          if (isTauri()) { event.preventDefault(); void run(async () => { await openUrl(CLAUDE_KEY_URL); }); }
        }}>Get a key</a></div>
        {connected ? <div className="row row--wrap">
          {status.selected !== "claude" && <Button disabled={busy} onClick={() => void run(() => choose("claude"))}>Use Claude</Button>}
          <Button variant="danger" disabled={busy} onClick={() => void run(async () => { setStatus(await disconnectProvider("claude")); setNote("Claude disconnected. Study tools use Gemini again. Your saved study material is kept."); })}>Disconnect Claude</Button>
        </div> : <div className="row row--wrap">
          <TextInput type="password" autoComplete="off" aria-label="Claude API key" placeholder="Paste Claude API key" value={key} onChange={(event) => setKey(event.target.value)} disabled={busy || !isTauri()} />
          <Button disabled={busy || !isTauri() || key.trim().length < 20} onClick={() => { const submitted = key; setKey(""); void run(async () => { setStatus(await configureProvider("claude", submitted)); setNote("Claude connected. Choose Use Claude when you are ready."); }); }}>{busy ? "Connecting…" : "Connect Claude"}</Button>
        </div>}
      </div>
    </details>
    {note && <p className="small" role={problem ? "alert" : "status"}>{note}</p>}
  </div>;
}
