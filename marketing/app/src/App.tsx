// Routes of the signed-in app; without a session only the sign-in page is shown.
import { LocationProvider, Route, Router } from "preact-iso";
import { Shell } from "./components/Shell";
import { Szene } from "./components/Szene";
import { Loading } from "./components/ui";
import { usePasswordRecovery } from "./hooks/recovery";
import { AdminContext, useAdminStatus } from "./hooks/role";
import { useSession } from "./hooks/useSession";
import { CampaignPage } from "./pages/Campaign";
import { Campaigns } from "./pages/Campaigns";
import { Guide } from "./pages/Guide";
import { Planer } from "./pages/Planer";
import { PostPage } from "./pages/Post";
import { SetPassword } from "./pages/SetPassword";
import { Settings } from "./pages/Settings";
import { SignIn } from "./pages/SignIn";

function NotFound() {
  return <p class="muted">Diese Seite gibt es nicht. <a href="/">Zu den Kampagnen</a></p>;
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
  const email = session.user.email ?? "";
  return (
    <AdminContext.Provider value={admin}>
      <LocationProvider>
        <Shell admin={admin}>
          <Router>
            <Route path="/" component={Campaigns} />
            <Route path="/kampagne/:id" component={({ id }: { id: string }) => <CampaignPage id={id} />} />
            <Route path="/beitrag/:id" component={({ id }: { id: string }) => <PostPage id={id} />} />
            <Route path="/planer" component={Planer} />
            <Route path="/anleitung" component={Guide} />
            <Route path="/einstellungen" component={() => <Settings email={email} />} />
            <Route default component={NotFound} />
          </Router>
        </Shell>
      </LocationProvider>
    </AdminContext.Provider>
  );
}
