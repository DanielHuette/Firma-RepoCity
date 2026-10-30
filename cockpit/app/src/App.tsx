// Routes of the signed-in Cockpit; without a session only the sign-in page is shown.
import { createContext } from "preact";
import { useCallback, useContext, useEffect, useState } from "preact/hooks";
import { LocationProvider, Route, Router } from "preact-iso";
import { listMessages, watchMessages } from "./api/cockpit";
import type { Message } from "./api/types";
import { Shell } from "./components/Shell";
import { Szene } from "./components/Szene";
import { Loading } from "./components/ui";
import { usePasswordRecovery } from "./hooks/recovery";
import { AdminContext, useAdminStatus } from "./hooks/role";
import { useSession } from "./hooks/useSession";
import { describeError } from "./lib/errors";
import { Assistent } from "./pages/Assistent";
import { Einstellungen } from "./pages/Einstellungen";
import { SetPassword } from "./pages/SetPassword";
import { SignIn } from "./pages/SignIn";
import { Zentrale } from "./pages/Zentrale";

function NotFound() {
  return <p class="muted">Diese Seite gibt es nicht. <a href="/">Zur Zentrale</a></p>;
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

export interface Feed {
  messages: Message[] | undefined;
  error: string | null;
  reload: () => void;
}

const FeedContext = createContext<Feed>({ messages: undefined, error: null, reload: () => undefined });

export function useFeedContext(): Feed {
  return useContext(FeedContext);
}

// The feed lives here so the unread badge in the sidebar and the page share one live list.
function useFeed(enabled: boolean): Feed {
  const [messages, setMessages] = useState<Message[] | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    listMessages().then((next) => { setMessages(next); setError(null); }, (reason: unknown) => { setError(describeError(reason)); });
  }, []);
  useEffect(() => {
    if (!enabled) return;
    reload();
    const stop = watchMessages(reload);
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      stop();
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [enabled, reload]);
  return { messages, error, reload };
}

function Arbeitsbereich({ email, admin }: { email: string; admin: boolean | undefined }) {
  const feed = useFeed(admin === true);
  const unread = feed.messages?.filter((message) => message.read_at === null).length ?? 0;
  useEffect(() => {
    // The number on the installed app icon follows the unread messages.
    if (!("setAppBadge" in navigator)) return;
    if (unread > 0) void navigator.setAppBadge(unread).catch(() => undefined);
    else void navigator.clearAppBadge().catch(() => undefined);
  }, [unread]);
  return (
    <FeedContext.Provider value={feed}>
      <Shell admin={admin} pending={unread}>
        {admin === false ? null : (
          <Router>
            <Route path="/" component={Zentrale} />
            <Route path="/assistent" component={Assistent} />
            <Route path="/einstellungen" component={() => <Einstellungen email={email} />} />
            <Route default component={NotFound} />
          </Router>
        )}
      </Shell>
    </FeedContext.Provider>
  );
}
