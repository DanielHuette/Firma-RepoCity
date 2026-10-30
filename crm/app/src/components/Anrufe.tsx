// Calls the phone assistant took: when, how long, what came out of it, the short summary and the
// full conversation to open on demand.
import { listCalls } from "../api/crm";
import type { Call, TranscriptLine } from "../api/types";
import { useAsync } from "../hooks/useAsync";
import { CALL_OUTCOME, SPEAKER, callDuration, callOutcomeTone } from "../lib/calls";
import { dateTime } from "../lib/format";
import { Badge, Empty, ErrorNote, Loading } from "./ui";

export function KundenAnrufe({ customerId }: { customerId: string }) {
  const calls = useAsync(() => listCalls(customerId), [customerId]);
  if (calls.error !== null) return <ErrorNote message={calls.error} />;
  if (calls.data === undefined) return <Loading />;
  if (calls.data.length === 0) return <Empty>Noch keine Anrufe beim Telefonassistenten.</Empty>;
  return <CallList calls={calls.data} showCaller={false} />;
}

export function CallList({ calls, showCaller }: { calls: Call[]; showCaller: boolean }) {
  return (
    <ul class="cards">
      {calls.map((call) => <li key={call.id}><CallEntry call={call} showCaller={showCaller} /></li>)}
    </ul>
  );
}

function Caller({ call }: { call: Call }) {
  if (call.customer !== null && call.customer !== undefined) return <a href={`/kunde/${call.customer.id}`}>{call.customer.name}</a>;
  return <span>{call.caller_number === "" ? "Unbekannte Nummer" : call.caller_number}</span>;
}

function CallEntry({ call, showCaller }: { call: Call; showCaller: boolean }) {
  return (
    <article class="call stack stack--tight">
      <div class="cluster">
        <Badge tone={callOutcomeTone(call.outcome)}>{CALL_OUTCOME[call.outcome]}</Badge>
        {showCaller && <Caller call={call} />}
        <span class="small muted num">{dateTime(call.started_at)} · {callDuration(call.started_at, call.ended_at)}</span>
      </div>
      <p>{call.summary === "" ? "Keine Zusammenfassung." : call.summary}</p>
      <details class="more">
        <summary>Gespräch ansehen</summary>
        {call.caller_number !== "" && <p class="small muted">Angerufen von {call.caller_number}</p>}
        <Transcript lines={call.transcript} />
      </details>
    </article>
  );
}

function Transcript({ lines }: { lines: TranscriptLine[] }) {
  if (lines.length === 0) return <Empty>Kein Gesprächsverlauf gespeichert.</Empty>;
  return (
    <ol class="transcript" aria-label="Gesprächsverlauf">
      {lines.map((line, index) => (
        <li key={String(index)} class={`transcript__line transcript__line--${line.speaker}`}>
          <span class="transcript__speaker">{SPEAKER[line.speaker]}</span>
          <span>{line.text}</span>
        </li>
      ))}
    </ol>
  );
}
