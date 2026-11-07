import { PROVIDER_TERMS } from "@/logic/providerTerms";
import { useEffect, useState, type ReactNode } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/data";
import { isIOS } from "@/services/platform";
import { Button, TextInput } from "@/components/ui";
import { CLAUDE_MODEL_CHOICES, getGeminiStatus, setGeminiModel, geminiModelName, type GeminiModelChoice } from "@/services/gemini";
import { SAVED_KEY_UNREADABLE, CLAUDE_KEY_URL, configureProvider, disconnectProvider, providerStatus, retryKeyAccess, selectProvider, type ProviderId, type ProviderStatus } from "@/services/provider";

export function ProviderControls({ children, onStatus, reloadToken = 0, onRetried }: { children: ReactNode; onStatus?: (status: ProviderStatus) => void; reloadToken?: number; onRetried?: () => void }) {
  const [status, setStatus] = useState<ProviderStatus>({ selected: "gemini", providers: [] });
  const [key, setKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [problem, setProblem] = useState(false);
  const [claudeChoice, setClaudeChoice] = useState<{ choice: GeminiModelChoice; model: string } | null>(null);
  useEffect(() => {
    if (isTauri()) void providerStatus().then(setStatus).catch(() => { setProblem(true); setNote("Could not check your AI connections. Reopen Settings to try again."); });
  }, [reloadToken]);
  useEffect(() => { onStatus?.(status); }, [status, onStatus]);
  const claudeReady = status.selected === "claude" && status.providers.some((p) => p.id === "claude" && p.connected);
  useEffect(() => {
    if (isTauri() && claudeReady) void getGeminiStatus().then((s) => setClaudeChoice({ choice: s.choice, model: s.model })).catch(() => setClaudeChoice(null));
    else setClaudeChoice(null);
  }, [claudeReady, reloadToken]);
  const unreadable = status.providers.some((p) => p.id === "claude" && p.keyUnreadable);
  const connected = status.providers.some((p) => p.id === "claude" && p.connected);
  async function run(work: () => Promise<void>) {
    setBusy(true); setProblem(false); setNote(null);
    try { await work(); }
    catch (error) { setProblem(true); setNote(typeof error === "string" ? error : "Could not save this change. Try again."); }
    finally { setBusy(false); }
  }
  const tryAgain = <div><Button disabled={busy} onClick={() => void run(async () => { setStatus(await retryKeyAccess()); onRetried?.(); })}>Try again</Button></div>;
  async function choose(id: ProviderId) {
    await selectProvider(id);
    setStatus(await providerStatus());
    setNote(`New study aids will use ${id === "claude" ? "Claude" : "Gemini"}. Your saved study material is kept.`);
  }
  const getKey = <div><a className="small" href={CLAUDE_KEY_URL} target="_blank" rel="noopener noreferrer" onClick={(event) => {
    if (isTauri()) { event.preventDefault(); void run(async () => { await openUrl(CLAUDE_KEY_URL); }); }
  }}>Get a key</a></div>;
  const keyBox = <div className="row row--wrap">
    <TextInput type="password" autoComplete="off" aria-label="Claude API key" placeholder="Paste Claude API key" value={key} onChange={(event) => setKey(event.target.value)} disabled={busy || !isTauri()} />
    <Button disabled={busy || !isTauri() || key.trim().length < 20} onClick={() => { const submitted = key; setKey(""); void run(async () => { setStatus(await configureProvider("claude", submitted)); setNote("Claude is connected and will be used for your study tools. Your saved study material is kept."); }); }}>{busy ? "Connecting…" : "Connect Claude"}</Button>
  </div>;
  const terms = PROVIDER_TERMS.claude;
  const privacy = <>{terms.privacy} (as of {terms.asOf}; see <a href={terms.termsUrl} target="_blank" rel="noopener noreferrer" onClick={(event) => {
    if (isTauri()) { event.preventDefault(); void run(async () => { await openUrl(terms.termsUrl); }); }
  }}>{terms.company}'s terms</a>)</>;
  const claude = (
      <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        <p className="small strong">Claude (Anthropic)</p>
        <p className="tiny dim">{privacy}</p>
        <p className="tiny dim">Your key stays on this {isIOS() ? "phone" : "computer"} and is not included in backups.</p>
        {unreadable ? <><p className="small" role="status">{SAVED_KEY_UNREADABLE}</p>{tryAgain}</> : getKey}
        {unreadable ? null : connected ? <div className="row row--wrap">
          {status.selected !== "claude" && <Button disabled={busy} onClick={() => void run(() => choose("claude"))}>Use Claude</Button>}
          <Button variant="danger" disabled={busy} onClick={() => void run(async () => { setStatus(await disconnectProvider("claude")); setNote("Claude disconnected. Study tools use Gemini again. Your saved study material is kept."); })}>Disconnect Claude</Button>
        </div> : keyBox}
      </div>
  );
  return <div className="stack stack--4">
    <p className="tiny dim">You need to be 18 or older and use your own API key. Your use of the AI service follows that company's terms.</p>
    {status.selected === "gemini" ? children : <div className="stack stack--2">
      <p className="small strong">{geminiModelName(claudeChoice?.model ?? "claude-haiku-5-5")} · {unreadable ? "Saved key unavailable" : connected ? "Ready to use" : "Connect Claude to use study tools"}</p>
      <p className="tiny dim">{privacy}</p>
      {claudeChoice && <fieldset className="gemini-model-choice stack stack--2">
        <legend className="field__label">Model for new study aids</legend>
        {(["standard", "most-capable"] as const).map((choice) => <label key={choice} className="small">
          <input type="radio" name="claude-model-choice" checked={claudeChoice.choice === choice} disabled={busy}
            onChange={() => void run(async () => { const next = await setGeminiModel(choice); setClaudeChoice({ choice: next.choice, model: next.model }); setNote(`New study aids will use ${geminiModelName(next.model)}. Saved study guides and flashcards are unchanged.`); })} />{" "}
          <span className="strong">{CLAUDE_MODEL_CHOICES[choice].label}</span>
          <span className="tiny dim"> — {CLAUDE_MODEL_CHOICES[choice].detail}</span>
        </label>)}
      </fieldset>}
      {unreadable ? <><p className="small" role="status">{SAVED_KEY_UNREADABLE}</p>{tryAgain}</> : connected
        ? <Button variant="danger" disabled={busy} onClick={() => void run(async () => { setStatus(await disconnectProvider("claude")); setNote("Claude disconnected. Study tools use Gemini again. Your saved study material is kept."); })}>Disconnect Claude</Button>
        // Claude chosen but its key is missing: let the student put a key back in.
        : <>{getKey}{keyBox}</>}
    </div>}
    <details key={status.selected}>
      <summary className="small">Use a different provider</summary>
      {status.selected === "gemini" ? claude : <div className="stack stack--3" style={{ marginTop: "var(--space-3)" }}>
        {children}
        <div><Button disabled={busy} onClick={() => void run(() => choose("gemini"))}>Use Gemini</Button></div>
      </div>}
    </details>
    {note && <p className="small" role={problem ? "alert" : "status"}>{note}</p>}
  </div>;
}
