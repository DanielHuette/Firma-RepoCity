// Settings of the Cockpit: lock-screen messages on this device, the registered devices, the app on
// the home screen and the account.
import { useEffect, useState } from "preact/hooks";
import { listDevices, removeDeviceById, sendTestMessage, signOut } from "../api/cockpit";
import type { Device } from "../api/types";
import { ErrorNote, Loading, PageHead } from "../components/ui";
import { isStandalone, useInstallPrompt } from "../hooks/install";
import { useAction, useAsync } from "../hooks/useAsync";
import { dateTime } from "../lib/format";
import { currentEndpoint, disablePush, enablePush, pushState, type PushState } from "../lib/push";

const STATE_TEXT: Record<PushState, string> = {
  on: "Auf diesem Gerät kommen alle Nachrichten auf den Sperrbildschirm.",
  off: "Auf diesem Gerät kommen noch keine Nachrichten an.",
  blocked: "Mitteilungen sind für das Cockpit in diesem Browser gesperrt. Erlaube sie in den Website-Einstellungen des Browsers und lade die Seite neu.",
  unsupported: "Dieser Browser kann keine Mitteilungen empfangen. Auf dem Android-Handy geht es mit Chrome.",
};

function usePushSettings() {
  const [state, setState] = useState<PushState | undefined>(undefined);
  const [endpoint, setEndpoint] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const devices = useAsync(() => listDevices(), []);
  const action = useAction();
  useEffect(() => {
    pushState().then(setState, () => { setState("unsupported"); });
    currentEndpoint().then(setEndpoint, () => undefined);
  }, []);
  const refresh = async () => {
    setState(await pushState());
    setEndpoint(await currentEndpoint());
    devices.reload();
  };
  const run = (task: () => Promise<void>) => { void action.run(task); };
  return { state, endpoint, sent, setSent, devices, action, refresh, run };
}

type PushSettings = ReturnType<typeof usePushSettings>;

function PushButtons({ push }: { push: PushSettings }) {
  const { state, action, run, refresh, setSent } = push;
  if (state === "off") {
    return (
      <button class="button button--primary" type="button" disabled={action.busy} onClick={() => { run(async () => { await enablePush(); await refresh(); }); }}>
        {action.busy ? "Wird eingerichtet …" : "Auf diesem Gerät einschalten"}
      </button>
    );
  }
  if (state !== "on") return null;
  return (
    <>
      <button class="button button--gold" type="button" disabled={action.busy} onClick={() => { run(async () => { setSent(false); await sendTestMessage(); setSent(true); }); }}>
        Testnachricht senden
      </button>
      <button class="button" type="button" disabled={action.busy} onClick={() => { run(async () => { await disablePush(); await refresh(); }); }}>
        Auf diesem Gerät ausschalten
      </button>
    </>
  );
}

function DeviceItem({ device, push }: { device: Device; push: PushSettings }) {
  return (
    <li class="spread device">
      <span>
        <strong>{device.device === "" ? "Gerät" : device.device}</strong>
        {device.endpoint === push.endpoint && <span class="badge badge--gold">dieses Gerät</span>}
        <span class="small muted block">
          {device.last_ok_at === null ? `eingerichtet ${dateTime(device.created_at)}` : `zuletzt erreicht ${dateTime(device.last_ok_at)}`}
          {device.failures > 0 && ` · ${String(device.failures)} Fehlversuche`}
        </span>
      </span>
      <button class="button button--quiet" type="button" disabled={push.action.busy} onClick={() => { push.run(async () => { await removeDeviceById(device.id); await push.refresh(); }); }}>
        Entfernen
      </button>
    </li>
  );
}

function DeviceList({ push }: { push: PushSettings }) {
  const devices = push.devices.data;
  if (devices === undefined) return <Loading />;
  if (devices.length === 0) return <p class="muted small">Noch kein Gerät eingerichtet.</p>;
  return <ul class="plain-list">{devices.map((device) => <DeviceItem key={device.id} device={device} push={push} />)}</ul>;
}

function Mitteilungen() {
  const push = usePushSettings();
  return (
    <section class="panel stack" aria-labelledby="push-head">
      <h2 id="push-head">Mitteilungen auf dem Sperrbildschirm</h2>
      {push.state === undefined ? <Loading /> : <p class={push.state === "blocked" ? "note note--bad" : "muted"}>{STATE_TEXT[push.state]}</p>}
      <div class="cluster"><PushButtons push={push} /></div>
      {push.sent && <p class="note note--good small">Unterwegs. Sie sollte in wenigen Sekunden erscheinen, auch bei geschlossener App.</p>}
      <ErrorNote message={push.action.error ?? push.devices.error} />
      <h3>Geräte</h3>
      <DeviceList push={push} />
    </section>
  );
}

function Installieren() {
  const prompt = useInstallPrompt();
  const action = useAction();
  if (isStandalone()) return null;
  return (
    <section class="panel stack" aria-labelledby="install-head">
      <h2 id="install-head">Cockpit als App</h2>
      <p class="muted">Als App auf dem Startbildschirm öffnet sich das Cockpit ohne Browserleiste und zeigt die Zahl ungelesener Nachrichten am Symbol.</p>
      {prompt.available ? (
        <button class="button button--primary" type="button" disabled={action.busy} onClick={() => { void action.run(async () => { await prompt.install(); }); }}>Installieren</button>
      ) : (
        <p class="small muted">Im Chrome-Menü (drei Punkte oben rechts) auf „Zum Startbildschirm hinzufügen“ tippen.</p>
      )}
    </section>
  );
}

export function Einstellungen({ email }: { email: string }) {
  const action = useAction();
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Cockpit" title="Einstellungen" />
      <Mitteilungen />
      <Installieren />
      <section class="panel stack" aria-labelledby="account-head">
        <h2 id="account-head">Konto</h2>
        <p class="muted">Angemeldet als {email}</p>
        <div><button class="button" type="button" disabled={action.busy} onClick={() => { void action.run(signOut); }}>Abmelden</button></div>
      </section>
    </div>
  );
}
