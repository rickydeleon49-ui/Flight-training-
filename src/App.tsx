import { HashRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { ErrorNote, Loading } from "@/components/ui";
import { FlightDeck } from "@/pages/FlightDeck/FlightDeck";
import { Settings } from "@/pages/Settings/Settings";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

/** Holds the shell back until the database is open, so no screen sees a
 *  half-loaded application. */
function Gate() {
  const { status, error, lastError, clearError } = useAppData();

  if (status === "loading") return <Loading label="Opening your flight deck" />;

  if (status === "error") {
    return (
      <div style={{ padding: "var(--space-6)", maxWidth: "40rem", margin: "0 auto" }}>
        <ErrorNote>
          <p className="strong">Your training data could not be opened.</p>
          <p style={{ marginTop: "var(--space-2)" }}>{error}</p>
        </ErrorNote>
      </div>
    );
  }

  return (
    <>
      {lastError ? (
        <div style={{ padding: "var(--space-4) var(--space-6) 0" }}>
          <ErrorNote>
            <div className="row row--between" style={{ width: "100%" }}>
              <span>{lastError}</span>
              <button type="button" className="button button--ghost button--small" onClick={clearError}>
                Dismiss
              </button>
            </div>
          </ErrorNote>
        </div>
      ) : null}

      <Routes>
        <Route element={<AppShell />}>
          <Route index element={<FlightDeck />} />
          <Route path="settings" element={<Settings />} />
        </Route>
      </Routes>
    </>
  );
}

export function App() {
  return (
    <AppDataProvider>
      {/* Hash routing keeps deep links working from a file:// desktop build. */}
      <HashRouter>
        <Gate />
      </HashRouter>
    </AppDataProvider>
  );
}
