import { lazy, useEffect } from "react";
import { HashRouter, Route, Routes } from "react-router-dom";

import { AppShell } from "@/components/layout/AppShell";
import { DataRecovery } from "@/components/recovery/DataRecovery";
import { Card, EmptyState, ErrorNote, Loading } from "@/components/ui";
import { FlightDeck } from "@/pages/FlightDeck/FlightDeck";
import { AppDataProvider, useAppData } from "@/state/AppDataContext";

// Keep the first screen small; each section loads when it is first opened.
const Finances = lazy(() => import("@/pages/Finances/Finances").then((m) => ({ default: m.Finances })));
const FlightJournal = lazy(() => import("@/pages/FlightJournal/FlightJournal").then((m) => ({ default: m.FlightJournal })));
const JournalEntryDetail = lazy(() => import("@/pages/FlightJournal/JournalEntryDetail").then((m) => ({ default: m.JournalEntryDetail })));
const JournalForm = lazy(() => import("@/pages/FlightJournal/JournalForm").then((m) => ({ default: m.JournalForm })));
const FlightPath = lazy(() => import("@/pages/FlightPath/FlightPath").then((m) => ({ default: m.FlightPath })));
const Notes = lazy(() => import("@/pages/Notes/Notes").then((m) => ({ default: m.Notes })));
const Questions = lazy(() => import("@/pages/Questions/Questions").then((m) => ({ default: m.Questions })));
const PilotToolkit = lazy(() => import("@/pages/PilotToolkit/PilotToolkit").then((m) => ({ default: m.PilotToolkit })));
const EventDetail = lazy(() => import("@/pages/Schedule/EventDetail").then((m) => ({ default: m.EventDetail })));
const Schedule = lazy(() => import("@/pages/Schedule/Schedule").then((m) => ({ default: m.Schedule })));
const Settings = lazy(() => import("@/pages/Settings/Settings").then((m) => ({ default: m.Settings })));
const MaterialDetail = lazy(() => import("@/pages/StudyLibrary/MaterialDetail").then((m) => ({ default: m.MaterialDetail })));
const StudyLibrary = lazy(() => import("@/pages/StudyLibrary/StudyLibrary").then((m) => ({ default: m.StudyLibrary })));

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
          <Route path="notes" element={<Notes />} />
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
