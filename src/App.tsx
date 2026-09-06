import { useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { DataRecovery } from "@/components/recovery/DataRecovery";
import { Card, EmptyState, ErrorNote, Loading } from "@/components/ui";
import { Finances } from "@/pages/Finances/Finances";
import { FlightDeck } from "@/pages/FlightDeck/FlightDeck";
import { FlightJournal } from "@/pages/FlightJournal/FlightJournal";
import { JournalEntryDetail } from "@/pages/FlightJournal/JournalEntryDetail";
import { JournalForm } from "@/pages/FlightJournal/JournalForm";
import { FlightPath } from "@/pages/FlightPath/FlightPath";
import { Questions } from "@/pages/Questions/Questions";
import { PilotToolkit } from "@/pages/PilotToolkit/PilotToolkit";
import { EventDetail } from "@/pages/Schedule/EventDetail";
import { Schedule } from "@/pages/Schedule/Schedule";
import { Settings } from "@/pages/Settings/Settings";
import { MaterialDetail } from "@/pages/StudyLibrary/MaterialDetail";
import { StudyLibrary } from "@/pages/StudyLibrary/StudyLibrary";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

/** Holds the shell back until the database is open, so no screen sees a
 *  half-loaded application. */
function Gate() {
  const { status, error, lastError, clearError, data } = useAppData();

  // Her chosen accent themes the whole interface.
  useEffect(() => {
    document.documentElement.dataset.accent = data.profile.accentColor;
  }, [data.profile.accentColor]);

  if (status === "loading") return <Loading label="Opening your flight deck" />;

  // A database that will not open is the one failure she cannot work around
  // herself, so this screen offers the way back rather than only the bad news.
  if (status === "error") return <DataRecovery error={error} />;

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
          <Route path="flight-path" element={<FlightPath />} />
          <Route path="study" element={<StudyLibrary />} />
          <Route path="study/:materialId" element={<MaterialDetail />} />
          <Route path="schedule" element={<Schedule />} />
          <Route path="schedule/:eventId" element={<EventDetail />} />
          <Route path="journal" element={<FlightJournal />} />
          <Route path="journal/new" element={<JournalForm />} />
          <Route path="journal/:entryId" element={<JournalEntryDetail />} />
          <Route path="journal/:entryId/edit" element={<JournalForm />} />
          <Route path="questions" element={<Questions />} />
          <Route path="finances" element={<Finances />} />
          <Route path="toolkit" element={<PilotToolkit />} />
          <Route path="settings" element={<Settings />} />
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </>
  );
}

/** Anything that is not a real screen lands here rather than a blank page. */
function NotFound() {
  return (
    <Card>
      <EmptyState
        title="That page isn't here."
        body="Use the navigation to get back to your flight deck."
      />
    </Card>
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
