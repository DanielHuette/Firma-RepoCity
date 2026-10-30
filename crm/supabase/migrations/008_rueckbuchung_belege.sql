-- RepoCity CRM, reversals netted after approval, receipts that are never lost, a fixed search path.
-- Context: builds on 007_finanzen.sql; decided with Daniel on 30.10.2026: a reversal is netted only
-- after his approval in the Cockpit, and then booked as Lexware Office books it ("Rücklastschrift",
-- help.lexware.de article 548566): both bookings go to "Durchlaufende Posten", so neither counts as
-- income or expense, and a paid invoice is open again; a later payment settles it as usual. A reversal
-- is an entry with RvslInd, with a return code (ISO 20022 sub-family or German business transaction
-- code, see crm.is_return_code and crm.is_return_gvc) or with return details (RtrInf). A receipt file stored
-- without its entry is added by an hourly check, otherwise reported on the lock screen. Every function
-- of crm gets a fixed search path (public, extensions), so it no longer depends on the caller (Supabase
-- lint 0011). | Input: statements, the receipts bucket, Daniel's decisions. | Output: columns
-- end_to_end_id and reverses_transaction_id of
-- crm.bank_transactions with status reversed, crm.expenses.reversed_by, approvals of kind reversal,
-- crm.reversal_candidates, crm.net_reversal, crm.check_receipts with cron job crm-receipts; the
-- Cockpit buttons are in cockpit/supabase/migrations/005_reversal_buttons.sql. Re-runnable.

-- Tables

alter table crm.bank_transactions add column if not exists end_to_end_id text not null default '';
-- On a reversal: the booking it takes back, set when Daniel nets the two.
alter table crm.bank_transactions add column if not exists reverses_transaction_id uuid unique
  references crm.bank_transactions (id) on delete restrict;
alter table crm.bank_transactions drop constraint if exists bank_transactions_status_check;
alter table crm.bank_transactions add constraint bank_transactions_status_check
  check (status in ('paid', 'suggested', 'open', 'other_income', 'private', 'expense', 'reversed'));
create index if not exists bank_transactions_reversal on crm.bank_transactions (amount, booking_date) where not reversal;

-- The reversal that took this expense back: the expense stays with its receipts but no longer counts.
alter table crm.expenses add column if not exists reversed_by uuid unique
  references crm.bank_transactions (id) on delete restrict;

alter table crm.approvals drop constraint if exists approvals_kind_check;
-- Not valid: on a re-run, approvals of the kinds 009 adds stay; 009 sets the full list again.
alter table crm.approvals add constraint approvals_kind_check
  check (kind in ('dunning', 'publication', 'quote', 'invoice', 'payment', 'contract', 'reversal', 'other')) not valid;

-- A booked bank transaction keeps what the bank said; a netted pair stays netted.
create or replace function crm.guard_bank_transaction() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Buchungen aus dem Kontoauszug bleiben stehen.'; end if;
  if (new.iban, new.dedupe_key, new.booking_date, new.value_date, new.direction, new.amount, new.counterparty,
      new.counterparty_iban, new.purpose, new.bank_reference, new.import_id, new.reversal, new.end_to_end_id)
     is distinct from (old.iban, old.dedupe_key, old.booking_date, old.value_date, old.direction, old.amount, old.counterparty,
      old.counterparty_iban, old.purpose, old.bank_reference, old.import_id, old.reversal, old.end_to_end_id) then
    raise exception 'Was die Bank gemeldet hat, lässt sich nicht ändern.';
  end if;
  if old.status = 'reversed' and (new.status <> 'reversed' or new.reverses_transaction_id is distinct from old.reverses_transaction_id) then
    raise exception 'Verrechnete Buchungen bleiben verrechnet.';
  end if;
  return new;
end $$;

create or replace function crm.guard_expense() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.transaction_id is not null or exists (select 1 from crm.receipts where expense_id = old.id) then
      raise exception 'Diese Ausgabe gehört zu einer Buchung oder hat einen Beleg und bleibt stehen.';
    end if;
    return old;
  end if;
  if (new.amount, new.spent_on, new.counterparty, new.method, new.transaction_id)
     is distinct from (old.amount, old.spent_on, old.counterparty, old.method, old.transaction_id)
     and (old.transaction_id is not null or exists (select 1 from crm.receipts where expense_id = old.id)) then
    raise exception 'Betrag, Datum und Empfänger einer gebuchten oder belegten Ausgabe bleiben, wie sie sind.';
  end if;
  if old.reversed_by is not null and new.reversed_by is distinct from old.reversed_by then
    raise exception 'Eine zurückgebuchte Ausgabe bleibt zurückgebucht.';
  end if;
  return new;
end $$;

-- Helpers

-- The bank's code of the transaction says a return or a cancelled booking. Sources: the lists of
-- business transaction codes with their ISO 20022 bank transaction codes of HypoVereinsbank
-- ("Geschäftsvorfall- und Rückgabecodes Elektronische Kontoinformation", August 2022) and Postbank
-- ("DFÜ-Spezifikationen Anlage 3 Anhang 1 GVC-BTC", 21.11.2021), the ING "Annex Transaction
-- Codification and Reason Reversal Codes" v11 and the ISO "Bank Transaction Code Sets" description.
-- ISO sub-families: RRTN, RPCR (credit transfer returned or recalled), UPDD, RCDD, PRDD (direct debit
-- returned or reversed), UPCT (card), UPCQ (cheque), XRTN (return of an incoming payment), PSTE (Storno).
create or replace function crm.is_return_code(p_code text) returns boolean
language sql immutable as $$
  select upper(coalesce(p_code, '')) in ('RRTN', 'RPCR', 'UPDD', 'RCDD', 'PRDD', 'UPCT', 'UPCQ', 'XRTN', 'PSTE')
$$;

-- German banks put the business transaction code (GVC) into the bank's own code, after the booking key
-- ("NTRF+166+97261" at Commerzbank and UniCredit) or first ("105+NDDT+…" at Deutsche Bank), as shown in
-- wikipayments.de thread 707 "Belegung des Feldes BkTxCd Prtry Cd"; the first number
-- of three digits is the GVC. Returns and cancellations in the lists named above: 108, 109 direct debit
-- returned; 110 card; 111, 183 cheque; 116 paydirekt reversed; 159, 160 credit transfer returned or
-- recalled; 181, 184 direct debit credited back; 182, 199 card clearing; 193 direct debit reversal;
-- 399, 899 Storno.
create or replace function crm.is_return_gvc(p_code text) returns boolean
language sql immutable as $$
  select coalesce((select t from unnest(string_to_array(coalesce(p_code, ''), '+')) t where t ~ '^[0-9]{3}$' limit 1)
    in ('108', '109', '110', '111', '116', '159', '160', '181', '182', '183', '184', '193', '199', '399', '899'), false)
$$;

-- Whether the bank transaction code below this node (an entry or a transaction) says a return.
create or replace function crm.camt_says_return(p_node xml) returns boolean
language sql immutable as $$
  select crm.is_return_code(crm.camt_text(p_node, '/*/*[local-name()=''BkTxCd'']/*[local-name()=''Domn'']/*[local-name()=''Fmly'']/*[local-name()=''SubFmlyCd'']'))
      or crm.is_return_gvc(crm.camt_text(p_node, '/*/*[local-name()=''BkTxCd'']/*[local-name()=''Prtry'']/*[local-name()=''Cd'']'))
$$;

-- Money the bank took back is no payment of a customer, so an open reversal does not hold reminders.
create or replace function crm.unclear_incoming() returns int
language sql stable as $$
  select count(*)::int from crm.bank_transactions where direction = 'in' and status in ('suggested', 'open') and not reversal
$$;

-- Removes a payment from its invoice, which is open again when the rest no longer covers it; the
-- customer file keeps what was removed and why.
create or replace function crm.remove_payment(p_payment uuid, p_why text) returns crm.invoices
language plpgsql as $$
declare v_payment crm.payments; v_invoice crm.invoices; v_paid numeric;
begin
  perform crm.require_writer();
  select * into v_payment from crm.payments where id = p_payment;
  select * into v_invoice from crm.invoices where id = v_payment.invoice_id for update;
  delete from crm.payments where id = p_payment;
  select coalesce(sum(amount), 0) into v_paid from crm.payments where invoice_id = v_invoice.id;
  update crm.invoices set paid_amount = v_paid,
    status = case when status = 'paid' and v_paid < gross then 'open' else status end,
    paid_at = case when v_paid < gross then null else paid_at end
   where id = v_invoice.id returning * into v_invoice;
  perform crm.log(v_invoice.customer_id, 'Zahlung über ' || crm.euro(v_payment.amount) || ' vom ' || crm.date_de(v_payment.paid_on)
    || case when v_payment.reference <> '' then ' („' || left(v_payment.reference, 120) || '“)' else '' end
    || ' von Rechnung ' || v_invoice.number || ' ' || p_why
    || case when v_invoice.status = 'open' then ' Die Rechnung ist wieder offen.' else '' end);
  return v_invoice;
end $$;

-- Takes an assignment back: a payment the import created is removed and the invoice reopened; a
-- payment entered by hand stays. The transaction is open again.
create or replace function crm.release_transaction(p_transaction uuid) returns crm.bank_transactions
language plpgsql as $$
declare v_tx crm.bank_transactions;
begin
  perform crm.require_writer();
  select * into v_tx from crm.bank_transactions where id = p_transaction for update;
  if v_tx.id is null or v_tx.status <> 'paid' then raise exception 'Diese Buchung ist keiner Rechnung zugeordnet.'; end if;
  update crm.bank_transactions set status = 'open', invoice_id = null, payment_id = null, payment_created = false where id = p_transaction;
  if v_tx.payment_created then
    perform crm.remove_payment(v_tx.payment_id, 'zurückgenommen; die Buchung vom ' || crm.date_de(v_tx.booking_date) || ' ist wieder offen.');
  end if;
  select * into v_tx from crm.bank_transactions where id = p_transaction;
  return v_tx;
end $$;

-- Filing a reversal by hand settles the question about netting it.
create or replace function crm.drop_reversal_question(p_transaction uuid) returns void
language sql as $$
  update crm.approvals set status = 'rejected', decided_at = now()
   where kind = 'reversal' and status = 'pending'
     and (payload ->> 'transaction_id' = p_transaction::text or payload ->> 'original_id' = p_transaction::text)
$$;

create or replace function crm.classify_outgoing(p_transaction uuid, p_status text) returns crm.bank_transactions
language plpgsql as $$
declare v_tx crm.bank_transactions;
begin
  perform crm.require_writer();
  if p_status not in ('expense', 'private') then raise exception 'Unbekannte Einordnung.'; end if;
  update crm.bank_transactions set status = p_status where id = p_transaction and direction = 'out' and status = 'open'
   returning * into v_tx;
  if v_tx.id is null then raise exception 'Diese Buchung lässt sich so nicht einordnen.'; end if;
  if p_status = 'expense' and not exists (select 1 from crm.expenses where transaction_id = v_tx.id) then
    perform crm.add_bank_expense(v_tx.id);
  end if;
  perform crm.drop_reversal_question(v_tx.id);
  return v_tx;
end $$;

create or replace function crm.classify_incoming(p_transaction uuid, p_status text, p_invoice uuid default null)
returns crm.bank_transactions
language plpgsql as $$
declare v_tx crm.bank_transactions;
begin
  perform crm.require_writer();
  if p_status = 'paid' then return crm.book_transaction_payment(p_transaction, p_invoice); end if;
  if p_status not in ('other_income', 'private') then raise exception 'Unbekannte Einordnung.'; end if;
  update crm.bank_transactions set status = p_status, invoice_id = null
   where id = p_transaction and direction = 'in' and status in ('open', 'suggested', 'other_income', 'private')
   returning * into v_tx;
  if v_tx.id is null then raise exception 'Diese Buchung lässt sich so nicht einordnen.'; end if;
  update crm.approvals set status = 'rejected', decided_at = now()
   where kind = 'payment' and status = 'pending' and payload ->> 'transaction_id' = p_transaction::text;
  perform crm.drop_reversal_question(v_tx.id);
  return v_tx;
end $$;

-- Assigning incoming money: a netted booking cannot be assigned again.

create or replace function crm.book_transaction_payment(p_transaction uuid, p_invoice uuid) returns crm.bank_transactions
language plpgsql as $$
declare v_tx crm.bank_transactions; v_invoice crm.invoices; v_payment uuid;
begin
  perform crm.require_writer();
  select * into v_tx from crm.bank_transactions where id = p_transaction for update;
  if v_tx.id is null or v_tx.direction <> 'in' or v_tx.reversal then raise exception 'Diese Buchung ist kein Zahlungseingang.'; end if;
  if v_tx.status = 'paid' then raise exception 'Diese Zahlung ist bereits einer Rechnung zugeordnet.'; end if;
  if v_tx.status = 'reversed' then raise exception 'Diese Zahlung wurde zurückgebucht.'; end if;
  select * into v_invoice from crm.invoices where id = p_invoice;
  if v_invoice.id is null or v_invoice.status <> 'open' or v_invoice.cancels_invoice_id is not null then
    raise exception 'Zuordnen geht nur zu einer offenen Rechnung.';
  end if;
  perform crm.record_payment(p_invoice, v_tx.amount, v_tx.booking_date, 'transfer',
    left(btrim(v_tx.counterparty || ' ' || v_tx.purpose), 500));
  select p.id into v_payment from crm.payments p
   where p.invoice_id = p_invoice and p.amount = v_tx.amount and p.paid_on = v_tx.booking_date
     and not exists (select 1 from crm.bank_transactions t where t.payment_id = p.id)
   order by p.created_at desc limit 1;
  update crm.bank_transactions set status = 'paid', invoice_id = p_invoice, payment_id = v_payment, payment_created = true
   where id = p_transaction returning * into v_tx;
  update crm.approvals set status = 'rejected', decided_at = now()
   where kind = 'payment' and status = 'pending' and payload ->> 'transaction_id' = p_transaction::text;
  return v_tx;
end $$;

create or replace function crm.link_payment(p_transaction uuid, p_payment uuid) returns crm.bank_transactions
language plpgsql as $$
declare v_tx crm.bank_transactions; v_payment crm.payments;
begin
  perform crm.require_writer();
  select * into v_tx from crm.bank_transactions where id = p_transaction for update;
  select * into v_payment from crm.payments where id = p_payment;
  if v_tx.id is null or v_tx.direction <> 'in' or v_tx.reversal or v_tx.status in ('paid', 'reversed') then
    raise exception 'Diese Buchung lässt sich keiner Zahlung zuordnen.';
  end if;
  if v_payment.id is null or v_payment.amount <> v_tx.amount
     or exists (select 1 from crm.bank_transactions where payment_id = p_payment) then
    raise exception 'Diese Zahlung passt nicht oder gehört schon zu einer Buchung.';
  end if;
  update crm.bank_transactions set status = 'paid', invoice_id = v_payment.invoice_id, payment_id = p_payment, payment_created = false
   where id = p_transaction returning * into v_tx;
  update crm.approvals set status = 'rejected', decided_at = now()
   where kind = 'payment' and status = 'pending' and payload ->> 'transaction_id' = p_transaction::text;
  return v_tx;
end $$;

-- An account chosen for a netted expense is kept, but its booking stays netted.
create or replace function crm.set_expense_account(p_expense uuid, p_account text, p_vat_rate numeric default null,
  p_learn boolean default true) returns crm.expenses
language plpgsql as $$
declare v_expense crm.expenses; v_key text; v_kind text; v_tx crm.bank_transactions;
begin
  perform crm.require_writer();
  select kind into v_kind from crm.expense_accounts where number = p_account;
  if v_kind is null then raise exception 'Dieses Konto steht nicht in der Liste.'; end if;
  -- Input VAT only exists for business expenses, never for private withdrawals or tax payments.
  update crm.expenses set account = p_account, vat_rate = case when v_kind = 'expense' then coalesce(p_vat_rate, vat_rate) else 0 end
   where id = p_expense returning * into v_expense;
  if v_expense.id is null then raise exception 'Diese Ausgabe gibt es nicht.'; end if;
  if v_expense.transaction_id is not null then
    select * into v_tx from crm.bank_transactions where id = v_expense.transaction_id;
    update crm.bank_transactions set status = case when v_kind = 'private' then 'private' else 'expense' end
     where id = v_expense.transaction_id and status <> 'reversed';
  end if;
  v_key := crm.payee_key(v_expense.counterparty, coalesce(v_tx.counterparty_iban, ''));
  if p_learn and v_key is not null and not crm.is_payment_service(v_key) then
    insert into crm.account_rules (payee_key, account) values (v_key, p_account)
    on conflict (payee_key) do update set account = excluded.account, updated_at = now();
    update crm.expenses e set account = p_account from crm.bank_transactions t
     where e.account is null and e.transaction_id = t.id and crm.payee_key(t.counterparty, t.counterparty_iban) = v_key;
    update crm.expenses set account = p_account
     where account is null and transaction_id is null and crm.payee_key(counterparty, '') = v_key;
    update crm.bank_transactions t set status = case when v_kind = 'private' then 'private' else 'expense' end
      from crm.expenses e where e.transaction_id = t.id and e.account = p_account and t.direction = 'out'
       and t.status <> 'reversed' and crm.payee_key(t.counterparty, t.counterparty_iban) = v_key;
  end if;
  return v_expense;
end $$;

-- Reversals

-- Bookings a reversal may take back: the other direction, the same amount and account, not netted,
-- at most 180 days before it; the best fits first (same end-to-end reference, then same account of
-- the other side).
create or replace function crm.reversal_candidates(p_reversal uuid) returns setof crm.bank_transactions
language sql stable as $$
  select c.* from crm.bank_transactions r join crm.bank_transactions c
    on c.id <> r.id and not c.reversal and c.direction <> r.direction and c.amount = r.amount and c.iban = r.iban
   and c.status <> 'reversed' and c.booking_date between r.booking_date - 180 and r.booking_date
   where r.id = p_reversal and r.reversal
   order by (r.end_to_end_id <> '' and c.end_to_end_id = r.end_to_end_id) desc,
            (r.counterparty_iban <> '' and c.counterparty_iban = r.counterparty_iban) desc,
            c.booking_date desc, c.created_at desc
   limit 50
$$;

create or replace function crm.reversal_effect(p_original crm.bank_transactions) returns text
language sql stable as $$
  select case
    when p_original.status = 'paid' then (select 'Rechnung ' || i.number
      || case when i.paid_amount - p_original.amount < i.gross then ' ist wieder offen.' else ': Zahlung entfernt, der Rest deckt sie.' end
      from crm.invoices i where i.id = p_original.invoice_id)
    when p_original.direction = 'out' and p_original.status = 'expense' then 'zählt nicht mehr als Ausgabe.'
    when p_original.status = 'other_income' then 'zählt nicht mehr als Einnahme.'
    else 'beide Buchungen heben sich auf.' end
$$;

-- The one booking a reversal clearly takes back: the only candidate with the same end-to-end
-- reference, or else the only one with the same account of the other side within 90 days; null otherwise.
create or replace function crm.clear_original(p_reversal crm.bank_transactions) returns uuid
language plpgsql stable as $$
declare v_ids uuid[];
begin
  if p_reversal.end_to_end_id <> '' then
    select coalesce(array_agg(c.id), '{}') into v_ids from crm.reversal_candidates(p_reversal.id) c
     where c.end_to_end_id = p_reversal.end_to_end_id;
    if cardinality(v_ids) = 1 then return v_ids[1]; end if;
    if cardinality(v_ids) > 1 then return null; end if;
  end if;
  if p_reversal.counterparty_iban <> '' then
    select coalesce(array_agg(c.id), '{}') into v_ids from crm.reversal_candidates(p_reversal.id) c
     where c.counterparty_iban = p_reversal.counterparty_iban and c.booking_date >= p_reversal.booking_date - 90;
    if cardinality(v_ids) = 1 then return v_ids[1]; end if;
  end if;
  return null;
end $$;

-- A new reversal: with one clear original Daniel is asked in the Cockpit, otherwise he is told to pick
-- it on the page Finanzen.
create or replace function crm.propose_reversal(p_reversal uuid) returns void
language plpgsql as $$
declare v_reversal crm.bank_transactions; v_original crm.bank_transactions; v_customer uuid;
begin
  perform crm.require_writer();
  select * into v_reversal from crm.bank_transactions where id = p_reversal;
  if v_reversal.id is null or not v_reversal.reversal or v_reversal.status <> 'open' then
    raise exception 'Diese Buchung ist keine offene Rückbuchung.';
  end if;
  if exists (select 1 from crm.approvals where kind = 'reversal' and status = 'pending' and payload ->> 'transaction_id' = p_reversal::text) then
    return;
  end if;
  select * into v_original from crm.bank_transactions where id = crm.clear_original(v_reversal);
  if v_original.id is null then
    perform crm.notify_cockpit('zahlung', 'Rückbuchung ohne passende Buchung: ' || crm.euro(v_reversal.amount),
      coalesce(nullif(v_reversal.counterparty, ''), 'Unbekannt') || ', ' || crm.date_de(v_reversal.booking_date) || ': „'
        || left(v_reversal.purpose, 140) || '“. Auf der Seite Finanzen die ursprüngliche Buchung auswählen.',
      'https://crm.speedofthespirit.dev/finanzen', 'wichtig', 'zahlung-' || v_reversal.id);
    return;
  end if;
  select customer_id into v_customer from crm.invoices where id = v_original.invoice_id;
  -- No invoice_id: a payment or cancellation of the invoice must not decide this question.
  insert into crm.approvals (kind, title, body, customer_id, payload)
  values ('reversal', 'Rückbuchung ' || crm.euro(v_reversal.amount) || ' verrechnen?',
          'Die Bank hat am ' || crm.date_de(v_reversal.booking_date) || ' ' || crm.euro(v_reversal.amount) || ' zurückgebucht. '
          || 'Ursprüngliche Buchung vom ' || crm.date_de(v_original.booking_date) || ': '
          || coalesce(nullif(v_original.counterparty, ''), 'Unbekannt') || ', „' || left(v_original.purpose, 140) || '“. '
          || 'Nach dem Verrechnen ' || crm.reversal_effect(v_original),
          v_customer, jsonb_build_object('transaction_id', v_reversal.id, 'original_id', v_original.id));
end $$;

-- Nets a reversal with the booking it takes back: both stop counting; a payment booked from the
-- original is removed and its invoice is open again; an expense from it stays with its receipts but
-- no longer counts.
create or replace function crm.net_reversal(p_reversal uuid, p_original uuid) returns crm.bank_transactions
language plpgsql as $$
declare v_reversal crm.bank_transactions; v_original crm.bank_transactions; v_effect text;
begin
  perform crm.require_writer();
  perform 1 from crm.bank_transactions where id in (p_reversal, p_original) order by id for update;
  select * into v_reversal from crm.bank_transactions where id = p_reversal;
  select * into v_original from crm.bank_transactions where id = p_original;
  if v_reversal.id is null or not v_reversal.reversal then raise exception 'Diese Buchung ist keine Rückbuchung.'; end if;
  if v_reversal.status = 'reversed' then raise exception 'Diese Rückbuchung ist bereits verrechnet.'; end if;
  if v_reversal.status <> 'open' then raise exception 'Diese Rückbuchung ist schon anders eingeordnet.'; end if;
  if v_original.id is null or v_original.reversal or v_original.direction = v_reversal.direction or v_original.amount <> v_reversal.amount
     or v_original.iban <> v_reversal.iban or v_original.booking_date > v_reversal.booking_date then
    raise exception 'Diese Buchung passt nicht zur Rückbuchung.';
  end if;
  if v_original.status = 'reversed' then raise exception 'Diese Buchung ist bereits verrechnet.'; end if;
  v_effect := crm.reversal_effect(v_original);

  if v_original.direction = 'in' then
    update crm.approvals set status = 'rejected', decided_at = now()
     where kind = 'payment' and status = 'pending' and payload ->> 'transaction_id' = p_original::text;
    -- The invoice stays named on the original, so the page and the tax package show what was taken back.
    update crm.bank_transactions set status = 'reversed', payment_id = null, payment_created = false
     where id = p_original;
    -- Also a payment entered by hand and linked to this transfer: the money behind it went back.
    if v_original.payment_id is not null then
      perform crm.remove_payment(v_original.payment_id, 'entfernt: am ' || crm.date_de(v_reversal.booking_date) || ' zurückgebucht.');
    end if;
  else
    update crm.expenses set reversed_by = p_reversal where transaction_id = p_original;
    update crm.bank_transactions set status = 'reversed' where id = p_original;
  end if;
  update crm.bank_transactions set status = 'reversed', reverses_transaction_id = p_original where id = p_reversal
  returning * into v_reversal;
  perform crm.drop_reversal_question(p_reversal);
  perform crm.drop_reversal_question(p_original);
  perform crm.notify_cockpit('zahlung', 'Rückbuchung verrechnet: ' || crm.euro(v_reversal.amount),
    coalesce(nullif(v_original.counterparty, ''), 'Unbekannt') || ', ' || crm.euro(v_original.amount) || ' vom '
      || crm.date_de(v_original.booking_date) || ': ' || v_effect,
    'https://crm.speedofthespirit.dev/finanzen', 'info', 'verrechnet-' || p_reversal);
  return v_reversal;
end $$;

create or replace function crm.decide_approval(p_approval uuid, p_approve boolean) returns crm.approvals
language plpgsql as $$
declare v_approval crm.approvals;
begin
  perform crm.require_writer();
  update crm.approvals set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now()
   where id = p_approval and status = 'pending' returning * into v_approval;
  if v_approval.id is null then raise exception 'Diese Freigabe ist bereits entschieden.'; end if;
  if p_approve and v_approval.kind = 'dunning' and v_approval.invoice_id is not null then
    perform crm.send_dunning(v_approval.invoice_id, least(greatest(coalesce((v_approval.payload ->> 'level')::int, 1), 1), 3), v_approval.id);
  elsif v_approval.kind = 'dunning' and v_approval.invoice_id is not null then
    -- "Nicht senden" pauses like a sent reminder, so the same reminder does not come back tomorrow.
    update crm.invoices set last_dunning_at = current_date where id = v_approval.invoice_id;
  elsif v_approval.kind = 'payment' and v_approval.payload ? 'transaction_id' then
    if p_approve then
      perform crm.book_transaction_payment((v_approval.payload ->> 'transaction_id')::uuid, v_approval.invoice_id);
    end if;  -- a rejection frees the transaction through crm.release_suggestion
  elsif v_approval.kind = 'reversal' and v_approval.payload ? 'original_id' then
    if p_approve then
      perform crm.net_reversal((v_approval.payload ->> 'transaction_id')::uuid, (v_approval.payload ->> 'original_id')::uuid);
    end if;  -- "Nicht verrechnen" leaves the reversal open on the page Finanzen
  elsif v_approval.kind = 'contract' and v_approval.payload ? 'contract_id' then
    if p_approve then
      perform crm.queue_contract((v_approval.payload ->> 'contract_id')::uuid, v_approval.id);
    else
      update crm.contracts set status = 'rejected' where id = (v_approval.payload ->> 'contract_id')::uuid and status = 'draft';
    end if;
  end if;
  perform crm.log(v_approval.customer_id, 'Freigabe „' || v_approval.title || '“ ' || case when p_approve then 'erteilt' else 'abgelehnt' end || '.');
  return v_approval;
end $$;

-- Profit: netted bookings count neither as income nor as expense.
create or replace function crm.profit_by_month(p_from date, p_to date) returns table (
  month date, income numeric, expenses numeric, unassigned numeric, profit numeric)
language sql stable as $$
  with months as (
    select generate_series(date_trunc('month', p_from), date_trunc('month', p_to), interval '1 month')::date as month
  ), money_in as (
    select date_trunc('month', paid_on)::date as month, sum(amount) as amount from crm.payments
     where paid_on between p_from and p_to group by 1
    union all
    select date_trunc('month', booking_date)::date, sum(amount) from crm.bank_transactions
     where direction = 'in' and status = 'other_income' and booking_date between p_from and p_to group by 1
  ), money_out as (
    select date_trunc('month', e.spent_on)::date as month,
           sum(e.amount) filter (where a.kind is null or a.kind in ('expense', 'tax')) as amount,
           sum(e.amount) filter (where e.account is null) as open_amount
      from crm.expenses e left join crm.expense_accounts a on a.number = e.account
     where e.spent_on between p_from and p_to and e.reversed_by is null group by 1
  )
  select m.month,
         coalesce((select sum(amount) from money_in i where i.month = m.month), 0),
         coalesce((select sum(amount) from money_out o where o.month = m.month), 0),
         coalesce((select sum(open_amount) from money_out o where o.month = m.month), 0),
         coalesce((select sum(amount) from money_in i where i.month = m.month), 0)
           - coalesce((select sum(amount) from money_out o where o.month = m.month), 0)
    from months m order by m.month
$$;

-- Reading a statement

-- As in 007, and: a reversal is also recognised by a return code (ISO or GVC) or return details; a reversal without
-- the expected party takes the opposite one; the end-to-end reference is kept; a new reversal goes to
-- crm.propose_reversal.
create or replace function crm.import_bank_statement(p_file_name text, p_xml text) returns jsonb
language plpgsql as $$
declare
  v_doc xml; v_iban text; v_stmt xml; v_entry xml; v_txs xml[]; v_tx xml; v_import crm.bank_imports;
  v_index int; v_amount numeric; v_direction text; v_booking date; v_value date; v_ref text; v_name text; v_cp_iban text;
  v_purpose text; v_e2e text; v_key text; v_hash text; v_count jsonb := '{}'; v_new crm.bank_transactions; v_expected text;
  v_entry_reversal boolean; v_reversal boolean; v_reversals int := 0; v_side text; v_other text; v_other_iban text;
  v_entries int := 0; v_new_entries int := 0; v_skipped int := 0; v_paid int := 0; v_suggested int := 0; v_open int := 0;
  v_expenses int := 0; v_from date; v_to date; v_last date; v_stmt_entries int; v_stmt_new int;
begin
  perform crm.require_writer();
  if p_xml is null or length(p_xml) = 0 then raise exception 'Die Datei ist leer.'; end if;
  -- Measured on 30.10.2026: 2,000 short bookings (about 1 MB) take 4.4 s, the signed-in role may run a
  -- statement for 8 s, so 1 MB leaves room for a slower server.
  if length(p_xml) > 1048576 then raise exception 'Der Kontoauszug ist größer als 1 MB. Bitte kürzere Zeiträume einzeln herunterladen.'; end if;
  if p_xml ~* '<!(DOCTYPE|ENTITY)' then raise exception 'Diese Datei ist kein Kontoauszug im Format CAMT.053.'; end if;
  select upper(regexp_replace(iban, '\s', '', 'g')) into v_expected from crm.settings where id = 1;
  if coalesce(v_expected, '') = '' then
    raise exception 'Bitte zuerst die IBAN des Geschäftskontos unter Einstellungen → Firma eintragen.';
  end if;
  begin
    v_doc := xmlparse(document regexp_replace(p_xml, '^\s*<\?xml[^>]*\?>', ''));
  exception when others then
    raise exception 'Diese Datei ist kein lesbares XML.';
  end;
  if cardinality(xpath('/*[local-name()=''Document'']/*[local-name()=''BkToCstmrStmt'']', v_doc)) = 0 then
    raise exception 'Diese Datei ist kein Kontoauszug im Format CAMT.053.';
  end if;

  foreach v_stmt in array xpath('/*[local-name()=''Document'']/*[local-name()=''BkToCstmrStmt'']/*[local-name()=''Stmt'']', v_doc) loop
    v_iban := upper(regexp_replace(coalesce(crm.camt_text(v_stmt, '/*/*[local-name()=''Acct'']/*[local-name()=''Id'']/*[local-name()=''IBAN'']'), ''), '\s', '', 'g'));
    if v_iban <> v_expected then
      raise exception 'Dieser Kontoauszug gehört zum Konto %, nicht zum Geschäftskonto aus den Einstellungen.', v_iban;
    end if;
    v_from := left(crm.camt_text(v_stmt, '/*/*[local-name()=''FrToDt'']/*[local-name()=''FrDtTm'']'), 10)::date;
    v_to := left(crm.camt_text(v_stmt, '/*/*[local-name()=''FrToDt'']/*[local-name()=''ToDtTm'']'), 10)::date;
    v_last := null; v_stmt_entries := 0; v_stmt_new := 0;
    insert into crm.bank_imports (file_name, iban, statement_from, statement_to)
    values (left(coalesce(p_file_name, ''), 300), v_iban, v_from, v_to) returning * into v_import;

    foreach v_entry in array xpath('/*/*[local-name()=''Ntry'']', v_stmt) loop
      v_entries := v_entries + 1; v_stmt_entries := v_stmt_entries + 1;
      if coalesce(crm.camt_text(v_entry, '/*/*[local-name()=''Sts'']/*[local-name()=''Cd'']'),
                  crm.camt_text(v_entry, '/*/*[local-name()=''Sts'']'), '') <> 'BOOK'
         or coalesce((xpath('/*/*[local-name()=''Amt'']/@Ccy', v_entry))[1]::text, '') <> 'EUR' then
        v_skipped := v_skipped + 1;
        continue;
      end if;
      v_direction := case crm.camt_text(v_entry, '/*/*[local-name()=''CdtDbtInd'']') when 'CRDT' then 'in' when 'DBIT' then 'out' end;
      if v_direction is null then v_skipped := v_skipped + 1; continue; end if;
      v_booking := left(coalesce(crm.camt_text(v_entry, '/*/*[local-name()=''BookgDt'']/*[local-name()=''Dt'']'),
                                 crm.camt_text(v_entry, '/*/*[local-name()=''BookgDt'']/*[local-name()=''DtTm'']')), 10)::date;
      v_value := left(coalesce(crm.camt_text(v_entry, '/*/*[local-name()=''ValDt'']/*[local-name()=''Dt'']'),
                               crm.camt_text(v_entry, '/*/*[local-name()=''ValDt'']/*[local-name()=''DtTm'']')), 10)::date;
      v_last := greatest(v_last, v_booking);
      v_ref := crm.real_reference(crm.camt_text(v_entry, '/*/*[local-name()=''AcctSvcrRef'']'));
      v_entry_reversal := coalesce(crm.camt_text(v_entry, '/*/*[local-name()=''RvslInd'']'), '') in ('true', '1')
        or crm.camt_says_return(v_entry);
      v_txs := xpath('/*/*[local-name()=''NtryDtls'']/*[local-name()=''TxDtls'']', v_entry);
      -- Several transactions only count separately when each names its own amount: directly below TxDtls
      -- (version 03 and later) or in AmtDtls/TxAmt (version 02).
      if cardinality(v_txs) > 1 and exists (select 1 from unnest(v_txs) t
          where cardinality(xpath('/*/*[local-name()=''Amt'']', t)) = 0
            and cardinality(xpath('/*/*[local-name()=''AmtDtls'']/*[local-name()=''TxAmt'']/*[local-name()=''Amt'']', t)) = 0) then
        v_txs := array[v_txs[1]];
      end if;
      if cardinality(v_txs) = 0 then v_txs := array[v_entry]; end if;
      v_index := 0;
      foreach v_tx in array v_txs loop
        v_index := v_index + 1;
        v_amount := coalesce(crm.camt_text(v_tx, '/*/*[local-name()=''Amt'']'),
                             crm.camt_text(v_tx, '/*/*[local-name()=''AmtDtls'']/*[local-name()=''TxAmt'']/*[local-name()=''Amt'']'),
                             crm.camt_text(v_entry, '/*/*[local-name()=''Amt'']'))::numeric;
        if cardinality(v_txs) = 1 then v_amount := crm.camt_text(v_entry, '/*/*[local-name()=''Amt'']')::numeric; end if;
        v_reversal := v_entry_reversal
          or cardinality(xpath('/*/*[local-name()=''RtrInf'']', v_tx)) > 0
          or crm.camt_says_return(v_tx);
        -- The other side: the debtor of money coming in, the creditor of money going out (camt.053.001.02
        -- has the name directly below Dbtr/Cdtr, later versions below Pty). A return may keep the parties
        -- of the original transfer, so for a reversal without that party the opposite one is taken,
        -- unless it is this account.
        v_side := case v_direction when 'in' then 'Dbtr' else 'Cdtr' end;
        v_other := case v_direction when 'in' then 'Cdtr' else 'Dbtr' end;
        v_cp_iban := upper(regexp_replace(coalesce(crm.camt_text(v_tx,
          '/*/*[local-name()=''RltdPties'']/*[local-name()=''' || v_side || 'Acct'']/*[local-name()=''Id'']/*[local-name()=''IBAN'']'), ''), '\s', '', 'g'));
        v_name := coalesce(
          crm.camt_text(v_tx, '/*/*[local-name()=''RltdPties'']/*[local-name()=''' || v_side || ''']/*[local-name()=''Nm'']'),
          crm.camt_text(v_tx, '/*/*[local-name()=''RltdPties'']/*[local-name()=''' || v_side || ''']/*[local-name()=''Pty'']/*[local-name()=''Nm'']'),
          '');
        if v_reversal and v_cp_iban = '' and v_name = '' then
          v_other_iban := upper(regexp_replace(coalesce(crm.camt_text(v_tx,
            '/*/*[local-name()=''RltdPties'']/*[local-name()=''' || v_other || 'Acct'']/*[local-name()=''Id'']/*[local-name()=''IBAN'']'), ''), '\s', '', 'g'));
          if v_other_iban <> v_iban then
            v_cp_iban := v_other_iban;
            v_name := coalesce(
              crm.camt_text(v_tx, '/*/*[local-name()=''RltdPties'']/*[local-name()=''' || v_other || ''']/*[local-name()=''Nm'']'),
              crm.camt_text(v_tx, '/*/*[local-name()=''RltdPties'']/*[local-name()=''' || v_other || ''']/*[local-name()=''Pty'']/*[local-name()=''Nm'']'),
              '');
          end if;
        end if;
        select coalesce(string_agg(btrim(u::text), ' '), '') into v_purpose
          from unnest(xpath('/*/*[local-name()=''RmtInf'']/*[local-name()=''Ustrd'']/text()', v_tx)) u;
        if v_purpose = '' then v_purpose := coalesce(crm.camt_text(v_entry, '/*/*[local-name()=''AddtlNtryInf'']'), ''); end if;
        v_name := left(btrim(regexp_replace(v_name, '\s+', ' ', 'g')), 300);
        v_purpose := left(btrim(regexp_replace(v_purpose, '\s+', ' ', 'g')), 1000);
        v_e2e := crm.real_reference(crm.camt_text(v_tx, '/*/*[local-name()=''Refs'']/*[local-name()=''EndToEndId'']'));
        -- The bank's reference is not unique by itself (placeholders, converted MT940 data), so the key is
        -- always a hash over everything the bank reported, counted for identical transactions of one file.
        v_hash := md5(concat_ws('|', v_ref, v_booking, v_value, v_direction, v_reversal, v_amount, v_name, v_cp_iban, v_purpose, v_e2e));
        v_count := jsonb_set(v_count, array[v_hash], to_jsonb(coalesce((v_count ->> v_hash)::int, 0) + 1));
        v_key := 'tx:' || v_hash || ':' || (v_count ->> v_hash);
        insert into crm.bank_transactions (import_id, iban, dedupe_key, booking_date, value_date, direction, amount,
          counterparty, counterparty_iban, purpose, bank_reference, reversal, end_to_end_id, status)
        values (v_import.id, v_iban, v_key, v_booking, v_value, v_direction, v_amount, v_name,
          v_cp_iban, v_purpose, left(v_ref, 120), v_reversal, left(v_e2e, 140),
          case when v_reversal or v_direction = 'in' then 'open' else 'expense' end)
        on conflict (iban, dedupe_key) do nothing
        returning * into v_new;
        if v_new.id is not null then
          v_new_entries := v_new_entries + 1; v_stmt_new := v_stmt_new + 1;
          if v_reversal then
            v_reversals := v_reversals + 1;
            perform crm.propose_reversal(v_new.id);
          elsif v_direction = 'in' then
            v_new := crm.assign_incoming(v_new.id);
            case v_new.status when 'paid' then v_paid := v_paid + 1; when 'suggested' then v_suggested := v_suggested + 1; else v_open := v_open + 1; end case;
          else
            perform crm.add_bank_expense(v_new.id);
            v_expenses := v_expenses + 1;
          end if;
        end if;
        v_new := null;
      end loop;
    end loop;
    -- Without an end date in the file the last booking day stands for it.
    update crm.bank_imports set entries = v_stmt_entries, new_entries = v_stmt_new,
      statement_to = coalesce(statement_to, v_last)
     where id = v_import.id;
  end loop;
  if v_import.id is null then raise exception 'Im Kontoauszug steht kein Konto.'; end if;
  return jsonb_build_object('entries', v_entries, 'new', v_new_entries, 'skipped', v_skipped, 'paid', v_paid,
    'suggested', v_suggested, 'open', v_open, 'expenses', v_expenses, 'reversals', v_reversals);
end $$;

-- Receipts

-- Saving the same file again (a retry after a lost answer) returns the receipt already stored.
create or replace function crm.add_receipt(p_expense uuid, p_path text, p_file_name text, p_content_type text, p_size int)
returns crm.receipts
language plpgsql as $$
declare v_receipt crm.receipts;
begin
  perform crm.require_writer();
  if p_path not like 'belege/' || p_expense || '/%' then raise exception 'Der Beleg liegt nicht bei dieser Ausgabe.'; end if;
  select * into v_receipt from crm.receipts where path = p_path;
  if v_receipt.id is not null then return v_receipt; end if;
  insert into crm.receipts (expense_id, path, file_name, content_type, size_bytes)
  values (p_expense, p_path, btrim(p_file_name), p_content_type, p_size)
  on conflict (path) do nothing returning * into v_receipt;
  if v_receipt.id is null then select * into v_receipt from crm.receipts where path = p_path; end if;
  return v_receipt;
end $$;

-- The file name of a stored receipt without the random prefix the app puts in front.
create or replace function crm.receipt_name(p_path text) returns text
language sql immutable as $$
  select regexp_replace(regexp_replace(coalesce(p_path, ''), '^.*/', ''), '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-', '')
$$;

-- Why a stored file cannot become a receipt; null when it can.
create or replace function crm.receipt_problem(p_path text, p_type text, p_size bigint) returns text
language sql stable as $$
  select case
    when p_path !~ '^belege/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/[^/]+$' then 'Die Datei liegt nicht im Ordner einer Ausgabe.'
    when not exists (select 1 from crm.expenses where id = substring(p_path from 8 for 36)::uuid) then 'Die Ausgabe dazu gibt es nicht.'
    when coalesce(p_type, '') not in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp') then 'Als Beleg gehen PDF, JPEG, PNG, HEIC oder WebP.'
    when coalesce(p_size, 0) not between 1 and 15728640 then 'Die Datei ist leer oder größer als 15 MB.'
  end
$$;

create or replace function crm.receipt_type(p_metadata jsonb, p_path text) returns text
language sql immutable as $$
  select coalesce(nullif(p_metadata ->> 'mimetype', ''), case lower(substring(p_path from '\.([A-Za-z0-9]+)$'))
    when 'pdf' then 'application/pdf' when 'jpg' then 'image/jpeg' when 'jpeg' then 'image/jpeg'
    when 'png' then 'image/png' when 'heic' then 'image/heic' when 'webp' then 'image/webp' end)
$$;

-- Hourly: a file in the receipts store older than ten minutes without its entry (the app's three tries
-- all failed) is added to its expense; one that cannot be is reported once on the lock screen.
create or replace function crm.check_receipts() returns int
language plpgsql security definer set search_path = '' as $$
declare v_file record; v_type text; v_size bigint; v_problem text; v_added int := 0;
begin
  for v_file in
    select o.id, o.name, o.metadata from storage.objects o
     where o.bucket_id = 'crm-receipts' and o.created_at < now() - interval '10 minutes'
       and not exists (select 1 from crm.receipts r where r.path = o.name)
     order by o.created_at
  loop
    v_type := crm.receipt_type(v_file.metadata, v_file.name);
    v_size := case when v_file.metadata ->> 'size' ~ '^[0-9]{1,12}$' then (v_file.metadata ->> 'size')::bigint end;
    v_problem := crm.receipt_problem(v_file.name, v_type, v_size);
    if v_problem is null then
      begin
        insert into crm.receipts (expense_id, path, file_name, content_type, size_bytes)
        values (substring(v_file.name from 8 for 36)::uuid, v_file.name, left(crm.receipt_name(v_file.name), 300), v_type, v_size::int)
        on conflict (path) do nothing;
        if found then v_added := v_added + 1; end if;
        continue;
      exception when others then
        raise warning 'receipt % not added: %', v_file.name, sqlerrm;
        v_problem := 'Die Datenbank hat den Eintrag abgelehnt.';
      end;
    end if;
    perform crm.notify_cockpit('beleg', 'Beleg nicht gespeichert: ' || crm.receipt_name(v_file.name),
      v_problem || ' Die Datei liegt im Belegspeicher; bitte unter Finanzen → Ausgaben neu anhängen.',
      'https://crm.speedofthespirit.dev/finanzen?tab=ausgaben', 'wichtig', 'beleg-' || v_file.id);
  end loop;
  return v_added;
end $$;

select cron.schedule('crm-receipts', '41 * * * *', $job$ select crm.check_receipts(); $job$);

-- Rights

revoke all on function crm.is_return_code(text), crm.is_return_gvc(text), crm.camt_says_return(xml), crm.remove_payment(uuid, text), crm.drop_reversal_question(uuid), crm.reversal_candidates(uuid),
  crm.reversal_effect(crm.bank_transactions), crm.clear_original(crm.bank_transactions), crm.propose_reversal(uuid),
  crm.net_reversal(uuid, uuid), crm.receipt_name(text), crm.receipt_problem(text, text, bigint), crm.receipt_type(jsonb, text),
  crm.check_receipts()
  from public, anon;
grant execute on function crm.is_return_code(text), crm.is_return_gvc(text), crm.camt_says_return(xml), crm.remove_payment(uuid, text), crm.drop_reversal_question(uuid), crm.reversal_candidates(uuid),
  crm.reversal_effect(crm.bank_transactions), crm.clear_original(crm.bank_transactions), crm.propose_reversal(uuid),
  crm.net_reversal(uuid, uuid), crm.receipt_name(text), crm.receipt_problem(text, text, bigint), crm.receipt_type(jsonb, text)
  to authenticated, service_role;
revoke all on function crm.check_receipts() from authenticated;
grant execute on function crm.check_receipts() to service_role;

-- Fixed search path: every function of crm without one gets public, extensions. All of them name their
-- tables and functions with the schema, so nothing they use moves; they just no longer depend on the
-- caller's path.
do $$
declare v_function regprocedure;
begin
  for v_function in
    select p.oid::regprocedure from pg_proc p
     where p.pronamespace = 'crm'::regnamespace and p.prokind = 'f'
       and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
       and not exists (select 1 from unnest(coalesce(p.proconfig, '{}')) c where c like 'search_path=%')
  loop
    execute format('alter function %s set search_path = public, extensions', v_function);
  end loop;
end $$;

notify pgrst, 'reload schema';
