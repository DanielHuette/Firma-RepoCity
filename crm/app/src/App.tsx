// Routes of the signed-in CRM; without a session only the sign-in page is shown. The print view
// renders outside the frame so the sheet is all that reaches the printer.
import { useCallback, useEffect, useState } from "preact/hooks";
import { LocationProvider, Route, Router, useLocation } from "preact-iso";
import { loadOverview, loadSettings } from "./api/crm";
import type { Settings } from "./api/types";
import { Shell } from "./components/Shell";
import { Szene } from "./components/Szene";
import { Loading } from "./components/ui";
import { usePasswordRecovery } from "./hooks/recovery";
import { AdminContext, useAdminStatus } from "./hooks/role";
import { SettingsContext } from "./hooks/settings";
import { useSession } from "./hooks/useSession";
import { Angebot } from "./pages/Angebot";
import { Druck } from "./pages/Druck";
import { Einstellungen } from "./pages/Einstellungen";
import { Finanzen } from "./pages/Finanzen";
import { Freigaben } from "./pages/Freigaben";
import { Heute } from "./pages/Heute";
import { Kalender } from "./pages/Kalender";
import { Kunde } from "./pages/Kunde";
import { Kunden } from "./pages/Kunden";
import { Rechnung } from "./pages/Rechnung";
import { Rechnungen } from "./pages/Rechnungen";
import { Service } from "./pages/Service";
import { SetPassword } from "./pages/SetPassword";
import { SignIn } from "./pages/SignIn";
import { Verkauf } from "./pages/Verkauf";

function NotFound() {
  return <p class="muted">Diese Seite gibt es nicht. <a href="/">Zu Heute</a></p>;
}

export function App() {
  const session = useSession();
  return (
    <>
      <Szene leise={session !== null && session !== undefined} />
      <Inhalt session={session} />
    </>
  );
}

function Inhalt({ session }: { session: ReturnType<typeof useSession> }) {
  const recovery = usePasswordRecovery();
  const admin = useAdminStatus(session?.user.id);
  if (session === undefined) {
    return (
      <main class="page">
        <Loading />
      </main>
    );
  }
  if (session === null) return <SignIn />;
  if (recovery.pending) return <SetPassword onDone={recovery.finish} />;
  return (
    <AdminContext.Provider value={admin}>
      <LocationProvider>
        <Arbeitsbereich email={session.user.email ?? ""} admin={admin} />
      </LocationProvider>
    </AdminContext.Provider>
  );
}

function useWorkspaceData(admin: boolean | undefined, path: string) {
  const [settings, setSettings] = useState<Settings | undefined>(undefined);
  const [pending, setPending] = useState(0);
  const reloadSettings = useCallback(() => { loadSettings().then(setSettings, () => undefined); }, []);
  const reloadPending = useCallback(() => {
    loadOverview().then((overview) => { setPending(overview.pending_approvals + overview.unknown_senders); }, () => undefined);
  }, []);
  useEffect(() => { if (admin === true) reloadSettings(); }, [admin, reloadSettings]);
  // The badge follows navigation, so decisions made elsewhere show up without a reload.
  useEffect(() => { if (admin === true) reloadPending(); }, [admin, path, reloadPending]);
  return { settings, reloadSettings, pending, reloadPending };
}

function Routes({ email, onPendingChange }: { email: string; onPendingChange: () => void }) {
  return (
    <Router>
      <Route path="/" component={Heute} />
      <Route path="/kalender" component={Kalender} />
      <Route path="/kunden" component={Kunden} />
      <Route path="/kunde/:id" component={({ id }: { id: string }) => <Kunde id={id} />} />
      <Route path="/verkauf" component={Verkauf} />
      <Route path="/angebot/:id" component={({ id }: { id: string }) => <Angebot id={id} />} />
      <Route path="/rechnungen" component={Rechnungen} />
      <Route path="/rechnung/:id" component={({ id }: { id: string }) => <Rechnung id={id} />} />
      <Route path="/finanzen" component={Finanzen} />
      <Route path="/service" component={Service} />
      <Route path="/freigaben" component={() => <Freigaben onChange={onPendingChange} />} />
      <Route path="/einstellungen" component={() => <Einstellungen email={email} />} />
      <Route path="/druck/:kind/:id" component={({ kind, id }: { kind: string; id: string }) => <Druck kind={kind} id={id} />} />
      <Route default component={NotFound} />
    </Router>
  );
}

function Arbeitsbereich({ email, admin }: { email: string; admin: boolean | undefined }) {
  const { path } = useLocation();
  const { settings, reloadSettings, pending, reloadPending } = useWorkspaceData(admin, path);
  const routes = <Routes email={email} onPendingChange={reloadPending} />;
  return (
    <SettingsContext.Provider value={{ settings, reload: reloadSettings }}>
      {path.startsWith("/druck/") ? routes : <Shell admin={admin} pending={pending}>{admin === false ? null : routes}</Shell>}
    </SettingsContext.Provider>
  );
}
