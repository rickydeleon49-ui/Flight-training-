import { useState, type MouseEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isTauri } from "@/data";
import { referencesForTask } from "@/logic/acsTaskReferences";

export function AcsTaskSources({ code }: { code?: string | null }) {
  const [error, setError] = useState(false);
  const sources = referencesForTask(code ?? "");
  if (!sources.length) return null;
  async function open(event: MouseEvent<HTMLAnchorElement>, url: string) {
    if (!isTauri()) return;
    event.preventDefault();
    setError(false);
    try { await openUrl(url); }
    catch { setError(true); }
  }
  const link = (url: string, name: string) => <a href={url} target="_blank" rel="noopener noreferrer"
    style={{ display: "inline-flex", alignItems: "center", minHeight: 44 }}
    onClick={(event) => { void open(event, url); }}>{name}</a>;
  return <details className="small muted">
    <summary style={{ cursor: "pointer", minHeight: 44, alignContent: "center" }}>Official sources</summary>
    <ul>{sources.map((source) => <li key={source.id}>
      {source.url ? link(source.url, source.name) : source.name}
    </li>)}</ul>
    <p className="tiny dim">From FAA-S-ACS-6C (November 2023, effective May 31, 2024).{" "}
      {link("https://www.faa.gov/training_testing/testing/acs", "Check the current FAA version.")}</p>
    {error ? <p role="alert">That link couldn't be opened. Please try again.</p> : null}
  </details>;
}
