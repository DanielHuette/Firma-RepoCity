// Delivery of a quote, an invoice or anything else to a customer: the mails in the outbox with their
// state, and the PDF the mail worker generated.
import { retryMail, documentLink } from "../api/crm";
import { listGeneratedPdfs, listMails, type MailOwner } from "../api/flow";
import type { OutboxMail } from "../api/types";
import { useAction, useAsync, type AsyncState } from "../hooks/useAsync";
import { OUTBOX_KIND, date, dateTime } from "../lib/format";
import { deliveredDocuments, mailState } from "../lib/states";
import { SignedLink } from "./SignedLink";
import { Badge, Empty, ErrorNote, Loading } from "./ui";

export function useMails(owner: MailOwner, id: string): AsyncState<OutboxMail[]> {
  return useAsync(() => listMails(owner, id), [owner, id]);
}

function MailRow({ mail, showKind, onRetry, busy }: { mail: OutboxMail; showKind: boolean; onRetry: () => void; busy: boolean }) {
  const state = mailState(mail);
  return (
    <li class="row">
      <span>
        {showKind && <strong>{OUTBOX_KIND[mail.kind]} · </strong>}{state.detail}
        <span class="small muted"> · erstellt {dateTime(mail.created_at)}</span>
      </span>
      <span class="cluster">
        <Badge tone={state.tone}>{state.label}</Badge>
        {mail.status === "failed" && <button class="button button--quiet" type="button" disabled={busy} onClick={onRetry}>Erneut senden</button>}
      </span>
    </li>
  );
}

export function MailList({ mails, showKind = false, empty }: { mails: AsyncState<OutboxMail[]>; showKind?: boolean; empty: string }) {
  const action = useAction();
  const retry = (id: string) => { void action.run(async () => { await retryMail(id); mails.reload(); }); };
  if (mails.error !== null) return <ErrorNote message={mails.error} />;
  if (mails.data === undefined) return <Loading />;
  if (mails.data.length === 0) return <Empty>{empty}</Empty>;
  return (
    <>
      <ErrorNote message={action.error} />
      <ul class="cards">
        {mails.data.map((mail) => <MailRow key={mail.id} mail={mail} showKind={showKind} busy={action.busy} onRetry={() => { retry(mail.id); }} />)}
      </ul>
    </>
  );
}

function GeneratedPdf({ owner, id }: { owner: "quote_id" | "invoice_id"; id: string }) {
  const pdfs = useAsync(() => listGeneratedPdfs(owner, id), [owner, id]);
  if (pdfs.error !== null) return <ErrorNote message={pdfs.error} />;
  const { main, dunning } = deliveredDocuments(pdfs.data ?? [], owner === "quote_id" ? "quote" : "invoice");
  return (
    <div class="cluster">
      {main === undefined ? <span class="small muted">Das PDF entsteht beim Versand.</span> : <SignedLink button label="Versendetes PDF herunterladen" sign={() => documentLink(main.file_path)} />}
      {dunning.map((letter) => <SignedLink key={letter.id} button label={`Mahnung vom ${date(letter.created_at)}`} sign={() => documentLink(letter.file_path)} />)}
    </div>
  );
}

export function Versand({ owner, id, mails }: { owner: "quote_id" | "invoice_id"; id: string; mails: AsyncState<OutboxMail[]> }) {
  return (
    <section class="panel stack" aria-labelledby="versand-head">
      <h2 id="versand-head">Versand</h2>
      <MailList mails={mails} empty="Noch keine E-Mail verschickt." />
      <GeneratedPdf owner={owner} id={id} />
    </section>
  );
}
