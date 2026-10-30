// Assistant: Daniel types or says what should happen; the server worker carries it out and answers
// as a notice of kind "assistent". The list below shows the last requests and what came of them.
import { useEffect, useState } from "preact/hooks";
import { useFeedContext } from "../App";
import { askAssistant, askAssistantAboutRecording, listAssistantRequests, uploadRecording } from "../api/cockpit";
import type { AssistantRequest } from "../api/types";
import { Badge, Empty, ErrorNote, Loading, PageHead } from "../components/ui";
import { useAction, useAsync, type AsyncState } from "../hooks/useAsync";
import { useVoiceRecorder, type VoiceRecorder } from "../hooks/voice";
import { assistantSignal, requestTitle, statusLabel, statusTone } from "../lib/assistant";
import { dayLabel, time } from "../lib/format";
import { MAX_SECONDS } from "../lib/recording";

const MAX_TEXT = 2000;

interface Pending {
  wav: ArrayBuffer;
  /** Set once the recording is stored, so a retry only repeats the request. */
  path: string | null;
}

function useSend(onSent: () => void) {
  const action = useAction();
  const [sent, setSent] = useState(false);
  const [pending, setPending] = useState<Pending | null>(null);
  const finish = (ok: boolean) => { setSent(ok); if (ok) onSent(); return ok; };
  const sendText = async (text: string) => { setPending(null); return finish(await action.run(() => askAssistant(text))); };
  const sendRecording = async (next: Pending) => {
    setSent(false);
    return finish(await action.run(async () => {
      setPending(next);
      const path = next.path ?? await uploadRecording(next.wav);
      setPending({ wav: next.wav, path });
      await askAssistantAboutRecording(path);
      setPending(null);
    }));
  };
  const discard = () => { setPending(null); action.clear(); };
  return { action, sent, setSent, pending, sendText, sendRecording, discard };
}

type Send = ReturnType<typeof useSend>;

const MIC_PATH = "M12 3.5a3 3 0 0 0-3 3v5a3 3 0 0 0 6 0v-5a3 3 0 0 0-3-3zM6 11.5a6 6 0 0 0 12 0M12 17.5V21M8.5 21h7";

function MicButton({ voice, disabled }: { voice: VoiceRecorder; disabled: boolean }) {
  const recording = voice.phase === "recording";
  const share = recording ? voice.secondsLeft / MAX_SECONDS : 1;
  return (
    <button class={`mic${recording ? " mic--live" : ""}`} type="button" onClick={voice.toggle} disabled={disabled || voice.phase === "starting"}
      aria-pressed={recording} aria-label={recording ? "Aufnahme beenden und senden" : "Sprachaufnahme starten"}
      style={{ "--share": String(share) }}>
      <svg viewBox="0 0 24 24" width="26" height="26" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
        {recording ? <rect x="7" y="7" width="10" height="10" rx="2" fill="currentColor" stroke="none" /> : <path d={MIC_PATH} />}
      </svg>
    </button>
  );
}

function VoiceStatus({ voice, busy }: { voice: VoiceRecorder; busy: boolean }) {
  if (voice.phase === "starting") return <p class="small muted" role="status">Mikrofon wird eingeschaltet …</p>;
  if (voice.phase === "recording") {
    return (
      <p class="voice-status" role="timer" aria-live="off">
        <span class="voice-status__count num">{voice.secondsLeft}</span>
        <span>Sekunden übrig. Tipp noch mal, wenn du fertig bist.</span>
      </p>
    );
  }
  return <p class="small muted">{busy ? "Wird gesendet …" : `Oder tipp aufs Mikrofon und sprich, höchstens ${String(MAX_SECONDS)} Sekunden.`}</p>;
}

function RetryRecording({ send }: { send: Send }) {
  if (send.pending === null || send.action.busy || send.action.error === null) return null;
  const pending = send.pending;
  return (
    <div class="cluster">
      <button class="button button--gold" type="button" onClick={() => { void send.sendRecording(pending); }}>Noch mal senden</button>
      <button class="button" type="button" onClick={send.discard}>Aufnahme verwerfen</button>
    </div>
  );
}

function Composer({ send }: { send: Send }) {
  const [text, setText] = useState("");
  const voice = useVoiceRecorder((wav) => { void send.sendRecording({ wav, path: null }); });
  const busy = send.action.busy;
  const submit = (event: Event) => {
    event.preventDefault();
    const trimmed = text.trim();
    if (trimmed === "" || busy) return;
    void send.sendText(trimmed).then((ok) => { if (ok) setText(""); });
  };
  return (
    <form class="panel stack composer" onSubmit={submit}>
      <label class="field">
        <span>Was soll ich tun?</span>
        <textarea class="textarea--short" value={text} maxLength={MAX_TEXT} rows={3} disabled={voice.phase !== "idle"}
          onInput={(event) => { setText(event.currentTarget.value); send.setSent(false); }} />
      </label>
      <div class="composer__row">
        <MicButton voice={voice} disabled={busy} />
        <VoiceStatus voice={voice} busy={busy} />
        <button class="button button--gold composer__send" type="submit" disabled={busy || voice.phase !== "idle" || text.trim() === ""}>Senden</button>
      </div>
      <ErrorNote message={voice.problem ?? send.action.error} />
      <RetryRecording send={send} />
      {send.sent && <p class="note note--good small" role="status">Angekommen. Das Ergebnis kommt als Nachricht und steht unten in der Liste.</p>}
    </form>
  );
}

function Help() {
  return (
    <section class="panel panel--flat stack stack--tight help" aria-labelledby="help-head">
      <h2 id="help-head">Das kann der Assistent</h2>
      <ul class="plain-list">
        <li><strong>Kontakt anlegen</strong> mit Name, Firma, E-Mail-Adresse und Telefon</li>
        <li><strong>Termin eintragen</strong> mit Tag, Uhrzeit, Kunde und Ort</li>
        <li><strong>Mail entwerfen</strong> an einen Kunden – sie geht erst raus, wenn du bei der Freigabe auf „Senden“ tippst</li>
        <li><strong>Umsatz nennen</strong> für einen Zeitraum, mit Einnahmen, Ausgaben und Gewinn</li>
      </ul>
      <p class="small muted">Eine Sprachaufnahme geht an deinen Server, wird dort in Text umgewandelt und danach gelöscht.</p>
    </section>
  );
}

function RequestItem({ request }: { request: AssistantRequest }) {
  return (
    <li class="request">
      <div class="request__head">
        <span class="request__title">{requestTitle(request)}</span>
        <Badge tone={statusTone(request.status)}>{statusLabel(request.status)}</Badge>
      </div>
      {request.result_text !== "" && <p class="request__result">{request.result_text}</p>}
      <p class="small muted num">{dayLabel(request.created_at)}, {time(request.created_at)} Uhr</p>
    </li>
  );
}

function RequestList({ requests }: { requests: AsyncState<AssistantRequest[]> }) {
  return (
    <section class="stack" aria-labelledby="requests-head">
      <h2 id="requests-head">Letzte Anfragen</h2>
      <ErrorNote message={requests.error} />
      {requests.data === undefined ? (requests.error === null && <Loading />)
        : requests.data.length === 0 ? <div class="panel panel--flat"><Empty>Noch keine Anfragen.</Empty></div>
          : <ul class="requests">{requests.data.map((request) => <RequestItem key={request.id} request={request} />)}</ul>}
    </section>
  );
}

// Reloads when an assistant notice arrives and when the app comes back to the screen, as the feed does.
function useRequests() {
  const signal = assistantSignal(useFeedContext().messages);
  const requests = useAsync(() => listAssistantRequests(), [signal]);
  const { reload } = requests;
  useEffect(() => {
    const onVisible = () => { if (document.visibilityState === "visible") reload(); };
    document.addEventListener("visibilitychange", onVisible);
    return () => { document.removeEventListener("visibilitychange", onVisible); };
  }, [reload]);
  return requests;
}

export function Assistent() {
  const requests = useRequests();
  const send = useSend(requests.reload);
  return (
    <div class="stack stack--loose">
      <PageHead kicker="Cockpit" title="Assistent" />
      <Composer send={send} />
      <Help />
      <RequestList requests={requests} />
    </div>
  );
}
