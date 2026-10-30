-- RepoCity CRM, finances: bank statements, matched incoming payments, expenses with receipts and
-- the profit per month by payment date (Einnahmen-Überschuss-Rechnung).
-- Context: builds on 001-006 and cockpit 002/003; decided with Daniel on 29.10.2026: statements as
-- CAMT.053 (ISO 20022 "BankToCustomerStatement", the export of German online banking), an incoming
-- payment is booked by itself only when its invoice number and amount fit, everything else is a
-- suggestion in the Cockpit; expenses get an account of the chart SKR03 from a fixed list, learnt per
-- payee; profit counts money when it moves. | Input: the XML text of a statement, Daniel's choices.
-- | Output: tables crm.bank_imports, crm.bank_transactions, crm.expense_accounts, crm.expenses,
-- crm.account_rules, crm.receipts, crm.expense_changes, storage bucket crm-receipts,
-- crm.import_bank_statement and the functions below; crm.run_dunning sends a reminder without approval
-- when the statements cover the invoice's due date and nothing incoming is unclear. The Cockpit
-- buttons for payment suggestions are in cockpit/supabase/migrations/004_payment_buttons.sql.
-- Re-runnable: every statement replaces or checks first.

-- Accounts

-- Names as in the DATEV standard chart SKR03: class 4 from the list "SKR Kontenrahmen 03 Klasse 4 -
-- 2023" of Ecovis RTS (www.ecovis-rts.de/servicecenter/kontenrahmen/skr-03-klasse-4.html); 1780,
-- 1800 and 1890 from "DATEV-Kontenrahmen ... Standardkontenrahmen (SKR 03), gültig für 2023",
-- DATEV Art.-Nr. 11174. kind says how the profit counts a payment on the account: expense and tax
-- lower it, private does not.
create table if not exists crm.expense_accounts (
  number text primary key check (number ~ '^[0-9]{4}$'),
  name text not null check (length(btrim(name)) between 1 and 120),
  kind text not null check (kind in ('expense', 'tax', 'private')),
  position int not null default 100
);

insert into crm.expense_accounts (number, name, kind, position) values
  ('4964', 'Aufwendungen für Lizenzen, Konzessionen', 'expense', 10),
  ('4806', 'Wartungskosten für Hard- und Software', 'expense', 20),
  ('4925', 'Telefax und Internetkosten', 'expense', 30),
  ('4920', 'Telefon', 'expense', 40),
  ('4600', 'Werbekosten', 'expense', 50),
  ('4930', 'Bürobedarf', 'expense', 60),
  ('4910', 'Porto', 'expense', 70),
  ('4940', 'Zeitschriften, Bücher', 'expense', 80),
  ('4945', 'Fortbildungskosten', 'expense', 90),
  ('4950', 'Rechts- und Beratungskosten', 'expense', 100),
  ('4955', 'Buchführungskosten', 'expense', 110),
  ('4957', 'Abschluss- und Prüfungskosten', 'expense', 120),
  ('4970', 'Nebenkosten des Geldverkehrs', 'expense', 130),
  ('4360', 'Versicherungen', 'expense', 140),
  ('4380', 'Beiträge', 'expense', 150),
  ('4210', 'Miete, unbewegliche Wirtschaftsgüter', 'expense', 160),
  ('4500', 'Fahrzeugkosten', 'expense', 170),
  ('4530', 'Laufende Kfz-Betriebskosten', 'expense', 180),
  ('4670', 'Reisekosten Unternehmer', 'expense', 190),
  ('4650', 'Bewirtungskosten', 'expense', 200),
  ('4855', 'Sofortabschreibung GWG', 'expense', 210),
  ('4980', 'Betriebsbedarf', 'expense', 220),
  ('4900', 'Sonstige betriebliche Aufwendungen', 'expense', 230),
  ('1780', 'Umsatzsteuer-Vorauszahlungen', 'tax', 240),
  ('1800', 'Privatentnahmen allgemein', 'private', 250)
on conflict (number) do update set name = excluded.name, kind = excluded.kind, position = excluded.position;

-- Bank statements

create table if not exists crm.bank_imports (
  id uuid primary key default gen_random_uuid(),
  file_name text not null default '' check (length(file_name) <= 300),
  iban text not null check (iban ~ '^[A-Z]{2}[0-9]{2}[A-Z0-9]{11,30}$'),
  statement_from date,
  statement_to date,
  entries int not null default 0,
  new_entries int not null default 0,
  imported_at timestamptz not null default now()
);

create table if not exists crm.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  import_id uuid not null references crm.bank_imports (id) on delete restrict,
  iban text not null,
  dedupe_key text not null,
  booking_date date not null,
  value_date date,
  direction text not null check (direction in ('in', 'out')),
  amount numeric(12, 2) not null check (amount > 0),
  counterparty text not null default '',
  counterparty_iban text not null default '',
  purpose text not null default '',
  bank_reference text not null default '',
  -- in: paid (booked to an invoice), suggested (approval waits), open (unclear), other_income, private;
  -- out: expense (row in crm.expenses), private, open (a reversal waiting for Daniel)
  status text not null check (status in ('paid', 'suggested', 'open', 'other_income', 'private', 'expense')),
  -- RvslInd of the entry: the bank takes back an earlier booking; never matched or turned into an expense by itself.
  reversal boolean not null default false,
  invoice_id uuid references crm.invoices (id) on delete restrict,
  payment_id uuid references crm.payments (id) on delete restrict,
  -- true when the import created the payment, so taking the assignment back also removes it.
  payment_created boolean not null default false,
  created_at timestamptz not null default now(),
  unique (iban, dedupe_key)
);
create index if not exists bank_transactions_status on crm.bank_transactions (direction, status);
create index if not exists bank_transactions_booking on crm.bank_transactions (booking_date);

-- Expenses: from a debit of the statement or entered by hand (cash). amount is what left the account,
-- vat_rate the rate on the receipt; as a small business there is no input VAT to claim.
create table if not exists crm.expenses (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid unique references crm.bank_transactions (id) on delete restrict,
  method text not null check (method in ('bank', 'cash')),
  spent_on date not null,
  amount numeric(12, 2) not null check (amount > 0),
  counterparty text not null default '' check (length(counterparty) <= 300),
  purpose text not null default '' check (length(purpose) <= 1000),
  account text references crm.expense_accounts (number) on delete restrict,
  vat_rate numeric(4, 2) not null default 0 check (vat_rate in (0, 7, 19)),
  created_at timestamptz not null default now(),
  check ((method = 'bank') = (transaction_id is not null))
);
create index if not exists expenses_spent on crm.expenses (spent_on);
create index if not exists expenses_unassigned on crm.expenses (spent_on) where account is null;

-- The account Daniel chose for a payee, proposed for the next expense of that payee.
create table if not exists crm.account_rules (
  payee_key text primary key check (length(payee_key) between 1 and 300),
  account text not null references crm.expense_accounts (number) on delete restrict,
  updated_at timestamptz not null default now()
);

-- Receipts are kept ten years (§ 147 Abs. 3 AO); a stored receipt cannot be changed or removed.
create table if not exists crm.receipts (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references crm.expenses (id) on delete restrict,
  path text not null unique check (path ~ '^belege/[0-9a-f-]{36}/[^/]+$'),
  file_name text not null check (length(btrim(file_name)) between 1 and 300),
  content_type text not null check (content_type in ('application/pdf', 'image/jpeg', 'image/png', 'image/heic', 'image/webp')),
  size_bytes int not null check (size_bytes between 1 and 15728640),
  uploaded_at timestamptz not null default now()
);
create index if not exists receipts_expense on crm.receipts (expense_id);

create or replace function crm.keep_receipt() returns trigger
language plpgsql as $$
begin
  raise exception 'Belege werden zehn Jahre aufbewahrt und lassen sich nicht ändern oder löschen.';
end $$;
drop trigger if exists keep_receipt on crm.receipts;
create trigger keep_receipt before update or delete on crm.receipts for each row execute function crm.keep_receipt();

-- An expense with a stored receipt keeps amount, date and payee; account and VAT rate stay open to correct.
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
  return new;
end $$;
drop trigger if exists guard_expense on crm.expenses;
create trigger guard_expense before update or delete on crm.expenses for each row execute function crm.guard_expense();

-- Every later change of account or VAT rate is kept with its time (GoBD: changes stay traceable).
create table if not exists crm.expense_changes (
  id uuid primary key default gen_random_uuid(),
  expense_id uuid not null references crm.expenses (id) on delete restrict,
  changed_at timestamptz not null default now(),
  old_account text,
  new_account text,
  old_vat_rate numeric(4, 2) not null,
  new_vat_rate numeric(4, 2) not null
);
create index if not exists expense_changes_expense on crm.expense_changes (expense_id, changed_at);

create or replace function crm.log_expense_change() returns trigger
language plpgsql as $$
begin
  if (new.account, new.vat_rate) is distinct from (old.account, old.vat_rate) then
    insert into crm.expense_changes (expense_id, old_account, new_account, old_vat_rate, new_vat_rate)
    values (new.id, old.account, new.account, old.vat_rate, new.vat_rate);
  end if;
  return new;
end $$;
drop trigger if exists log_expense_change on crm.expenses;
create trigger log_expense_change after update on crm.expenses for each row execute function crm.log_expense_change();

create or replace function crm.keep_expense_change() returns trigger
language plpgsql as $$
begin
  raise exception 'Der Verlauf einer Ausgabe lässt sich nicht ändern oder löschen.';
end $$;
drop trigger if exists keep_expense_change on crm.expense_changes;
create trigger keep_expense_change before update or delete on crm.expense_changes for each row execute function crm.keep_expense_change();

-- A booked bank transaction keeps what the bank said; only its assignment moves.
create or replace function crm.guard_bank_transaction() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Buchungen aus dem Kontoauszug bleiben stehen.'; end if;
  if (new.iban, new.dedupe_key, new.booking_date, new.value_date, new.direction, new.amount, new.counterparty,
      new.counterparty_iban, new.purpose, new.bank_reference, new.import_id, new.reversal)
     is distinct from (old.iban, old.dedupe_key, old.booking_date, old.value_date, old.direction, old.amount, old.counterparty,
      old.counterparty_iban, old.purpose, old.bank_reference, old.import_id, old.reversal) then
    raise exception 'Was die Bank gemeldet hat, lässt sich nicht ändern.';
  end if;
  return new;
end $$;
drop trigger if exists guard_bank_transaction on crm.bank_transactions;
create trigger guard_bank_transaction before update or delete on crm.bank_transactions
  for each row execute function crm.guard_bank_transaction();

-- Helpers

create or replace function crm.payee_key(p_name text, p_iban text) returns text
language sql immutable as $$
  select coalesce(nullif(lower(regexp_replace(coalesce(p_name, ''), '[^[:alnum:]]', '', 'g')), ''),
                  nullif(upper(regexp_replace(coalesce(p_iban, ''), '\s', '', 'g')), ''))
$$;

-- Payment services collect for many shops; one learnt account would be wrong for most of their payments.
create or replace function crm.is_payment_service(p_key text) returns boolean
language sql immutable as $$
  select coalesce(p_key, '') ~ '^(paypal|amazon|klarna|stripe|sumup|mollie|adyen|unzer|payone|ratepay|sofort|giropay)'
$$;

-- References that banks fill in when there is none (ISO 20022 "NOTPROVIDED", MT940 "NONREF").
create or replace function crm.real_reference(p_text text) returns text
language sql immutable as $$
  select case when upper(btrim(coalesce(p_text, ''))) in ('', 'NONREF', 'NOTPROVIDED', 'NOT PROVIDED', 'NONE', 'N/A', 'KREF+NONREF')
              then '' else btrim(p_text) end
$$;

-- Text of the first element with this local name below p_node, so every version of camt.053 and any
-- namespace prefix reads the same; null when absent.
create or replace function crm.camt_text(p_node xml, p_path text) returns text
language sql immutable as $$
  select nullif(btrim((xpath(p_path || '/text()', p_node))[1]::text), '')
$$;

-- The invoice number in a payment reference: prefix, year and serial with any separators or none
-- between them ("RE-2026-0007", "RE 2026 0007", "RE20260007"), never as part of a longer number.
create or replace function crm.mentions_invoice(p_text text, p_number text) returns boolean
language sql immutable as $$
  select p_number is not null and p_number ~ '^[A-Za-z]+-[0-9]{4}-[0-9]+$' and
    upper(coalesce(p_text, '')) ~ ('(^|[^A-Z0-9])' || split_part(upper(p_number), '-', 1) || '[^A-Z0-9]{0,3}'
      || split_part(p_number, '-', 2) || '[^A-Z0-9]{0,3}' || split_part(p_number, '-', 3) || '($|[^0-9])')
$$;

-- The last day the loaded statements cover; null before the first one.
create or replace function crm.bank_statement_until() returns date
language sql stable as $$ select max(statement_to) from crm.bank_imports $$;

create or replace function crm.unclear_incoming() returns int
language sql stable as $$
  select count(*)::int from crm.bank_transactions where direction = 'in' and status in ('suggested', 'open')
$$;

create or replace function crm.open_amount(p_invoice crm.invoices) returns numeric
language sql stable as $$ select p_invoice.gross - p_invoice.paid_amount $$;

-- Assigning incoming money

create or replace function crm.book_transaction_payment(p_transaction uuid, p_invoice uuid) returns crm.bank_transactions
language plpgsql as $$
declare v_tx crm.bank_transactions; v_invoice crm.invoices; v_payment uuid;
begin
  perform crm.require_writer();
  select * into v_tx from crm.bank_transactions where id = p_transaction for update;
  if v_tx.id is null or v_tx.direction <> 'in' or v_tx.reversal then raise exception 'Diese Buchung ist kein Zahlungseingang.'; end if;
  if v_tx.status = 'paid' then raise exception 'Diese Zahlung ist bereits einer Rechnung zugeordnet.'; end if;
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

create or replace function crm.suggest_payment(p_tx crm.bank_transactions, p_invoice crm.invoices, p_reason text) returns void
language plpgsql as $$
begin
  update crm.bank_transactions set status = 'suggested', invoice_id = p_invoice.id where id = p_tx.id;
  insert into crm.approvals (kind, title, body, customer_id, invoice_id, payload)
  values ('payment', 'Zahlung ' || crm.euro(p_tx.amount) || ' zu Rechnung ' || p_invoice.number || '?',
          p_reason || ' Eingang am ' || to_char(p_tx.booking_date, 'DD.MM.YYYY') || ' von ' || coalesce(nullif(p_tx.counterparty, ''), 'unbekannt')
          || ': „' || left(p_tx.purpose, 140) || '“. Offen: ' || crm.euro(crm.open_amount(p_invoice)) || '.',
          p_invoice.customer_id, p_invoice.id, jsonb_build_object('transaction_id', p_tx.id));
end $$;

-- Ties an incoming transaction to a payment already entered by hand.
create or replace function crm.link_payment(p_transaction uuid, p_payment uuid) returns crm.bank_transactions
language plpgsql as $$
declare v_tx crm.bank_transactions; v_payment crm.payments;
begin
  perform crm.require_writer();
  select * into v_tx from crm.bank_transactions where id = p_transaction for update;
  select * into v_payment from crm.payments where id = p_payment;
  if v_tx.id is null or v_tx.direction <> 'in' or v_tx.reversal or v_tx.status = 'paid' then
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

-- Payments entered by hand with this amount that no bank transaction carries yet.
create or replace function crm.unlinked_payments(p_amount numeric) returns table (
  id uuid, invoice_id uuid, invoice_number text, customer_name text, amount numeric, paid_on date)
language sql stable as $$
  select p.id, p.invoice_id, i.number, coalesce(i.customer_snapshot ->> 'name', c.name), p.amount, p.paid_on
    from crm.payments p join crm.invoices i on i.id = p.invoice_id left join crm.customers c on c.id = i.customer_id
   where p.amount = p_amount and not exists (select 1 from crm.bank_transactions t where t.payment_id = p.id)
   order by p.paid_on desc limit 50
$$;

-- Takes an assignment back: a payment the import created is removed and the invoice reopened; a
-- payment entered by hand stays. The transaction is open again.
create or replace function crm.release_transaction(p_transaction uuid) returns crm.bank_transactions
language plpgsql as $$
declare v_tx crm.bank_transactions; v_paid numeric; v_invoice crm.invoices;
begin
  perform crm.require_writer();
  select * into v_tx from crm.bank_transactions where id = p_transaction for update;
  if v_tx.id is null or v_tx.status <> 'paid' then raise exception 'Diese Buchung ist keiner Rechnung zugeordnet.'; end if;
  update crm.bank_transactions set status = 'open', invoice_id = null, payment_id = null, payment_created = false where id = p_transaction;
  if v_tx.payment_created then
    delete from crm.payments where id = v_tx.payment_id;
    select coalesce(sum(amount), 0) into v_paid from crm.payments where invoice_id = v_tx.invoice_id;
    update crm.invoices set paid_amount = v_paid,
      status = case when status = 'paid' and v_paid < gross then 'open' else status end,
      paid_at = case when v_paid < gross then null else paid_at end
     where id = v_tx.invoice_id returning * into v_invoice;
    perform crm.log(v_invoice.customer_id, 'Zahlung über ' || crm.euro(v_tx.amount) || ' von Rechnung ' || v_invoice.number
      || ' zurückgenommen; die Buchung vom ' || to_char(v_tx.booking_date, 'DD.MM.YYYY') || ' ist wieder offen.');
  end if;
  select * into v_tx from crm.bank_transactions where id = p_transaction;
  return v_tx;
end $$;

-- An incoming payment: one open invoice named with the exact open amount is booked; one named
-- invoice with another amount, or no number but exactly one open invoice with that amount, becomes
-- a suggestion; anything else stays open with a notice.
create or replace function crm.assign_incoming(p_transaction uuid) returns crm.bank_transactions
language plpgsql as $$
declare v_tx crm.bank_transactions; v_named crm.invoices[]; v_same crm.invoices[]; v_known uuid[];
begin
  perform crm.require_writer();
  select * into v_tx from crm.bank_transactions where id = p_transaction;
  -- A payment Daniel entered by hand before the statement came: link it, do not book it twice.
  select coalesce(array_agg(p.id), '{}') into v_known from crm.payments p join crm.invoices i on i.id = p.invoice_id
   where i.cancels_invoice_id is null and crm.mentions_invoice(v_tx.purpose, i.number) and p.amount = v_tx.amount
     and not exists (select 1 from crm.bank_transactions t where t.payment_id = p.id);
  if cardinality(v_known) = 1 then
    return crm.link_payment(v_tx.id, v_known[1]);
  end if;
  select coalesce(array_agg(i order by i.number), '{}') into v_named from crm.invoices i
   where i.status = 'open' and i.cancels_invoice_id is null and crm.mentions_invoice(v_tx.purpose, i.number);
  if cardinality(v_named) = 1 and crm.open_amount(v_named[1]) = v_tx.amount then
    return crm.book_transaction_payment(v_tx.id, v_named[1].id);
  end if;
  if cardinality(v_named) = 1 then
    perform crm.suggest_payment(v_tx, v_named[1], 'Die Rechnungsnummer steht im Verwendungszweck, der Betrag passt nicht.');
  elsif cardinality(v_named) = 0 then
    select coalesce(array_agg(i), '{}') into v_same from crm.invoices i
     where i.status = 'open' and i.cancels_invoice_id is null and crm.open_amount(i) = v_tx.amount;
    if cardinality(v_same) = 1 then
      perform crm.suggest_payment(v_tx, v_same[1], 'Der Betrag passt, eine Rechnungsnummer steht nicht im Verwendungszweck.');
    end if;
  end if;
  select * into v_tx from crm.bank_transactions where id = p_transaction;
  if v_tx.status = 'open' then
    perform crm.notify_cockpit('zahlung', 'Zahlungseingang ohne Rechnung: ' || crm.euro(v_tx.amount),
      coalesce(nullif(v_tx.counterparty, ''), 'Unbekannt') || ', ' || to_char(v_tx.booking_date, 'DD.MM.YYYY') || ': „' || left(v_tx.purpose, 160) || '“',
      'https://crm.speedofthespirit.dev/finanzen', 'wichtig', 'zahlung-' || v_tx.id);
  end if;
  return v_tx;
end $$;

-- A reversal or any debit Daniel decides on: an expense of its own, or private.
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
  return v_tx;
end $$;

-- Daniel's decision on an incoming payment from the Finanzen page.
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
  return v_tx;
end $$;

-- Expenses

create or replace function crm.rule_account(p_name text, p_iban text) returns text
language sql stable as $$
  select account from crm.account_rules
   where payee_key = crm.payee_key(p_name, p_iban) and not crm.is_payment_service(crm.payee_key(p_name, p_iban))
$$;

create or replace function crm.add_bank_expense(p_transaction uuid) returns crm.expenses
language plpgsql as $$
declare v_tx crm.bank_transactions; v_expense crm.expenses; v_account text;
begin
  select * into v_tx from crm.bank_transactions where id = p_transaction;
  v_account := crm.rule_account(v_tx.counterparty, v_tx.counterparty_iban);
  if v_account is not null and (select kind from crm.expense_accounts where number = v_account) = 'private' then
    update crm.bank_transactions set status = 'private' where id = p_transaction;
  end if;
  insert into crm.expenses (transaction_id, method, spent_on, amount, counterparty, purpose, account)
  values (v_tx.id, 'bank', v_tx.booking_date, v_tx.amount, left(v_tx.counterparty, 300), left(v_tx.purpose, 1000), v_account)
  returning * into v_expense;
  return v_expense;
end $$;

-- Daniel picks the account (and the rate on the receipt); the choice becomes the rule for the payee
-- and fills every expense of that payee still without an account.
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
    update crm.bank_transactions set status = case when v_kind = 'private' then 'private' else 'expense' end
     where id = v_expense.transaction_id returning * into v_tx;
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
       and crm.payee_key(t.counterparty, t.counterparty_iban) = v_key;
  end if;
  return v_expense;
end $$;

create or replace function crm.add_cash_expense(p_spent_on date, p_amount numeric, p_counterparty text, p_purpose text,
  p_account text, p_vat_rate numeric default 0) returns crm.expenses
language plpgsql as $$
declare v_expense crm.expenses;
begin
  perform crm.require_writer();
  if p_spent_on is null or p_spent_on > current_date then raise exception 'Das Datum darf nicht in der Zukunft liegen.'; end if;
  if length(btrim(coalesce(p_counterparty, ''))) = 0 then raise exception 'Bitte angeben, wo bezahlt wurde.'; end if;
  insert into crm.expenses (method, spent_on, amount, counterparty, purpose, account, vat_rate)
  values ('cash', p_spent_on, p_amount, btrim(p_counterparty), btrim(coalesce(p_purpose, '')), nullif(p_account, ''), coalesce(p_vat_rate, 0))
  returning * into v_expense;
  if v_expense.account is not null then
    perform crm.set_expense_account(v_expense.id, v_expense.account, v_expense.vat_rate);
  end if;
  return v_expense;
end $$;

-- Called after the file is in the bucket crm-receipts under belege/<expense id>/<name>.
create or replace function crm.add_receipt(p_expense uuid, p_path text, p_file_name text, p_content_type text, p_size int)
returns crm.receipts
language plpgsql as $$
declare v_receipt crm.receipts;
begin
  perform crm.require_writer();
  if p_path not like 'belege/' || p_expense || '/%' then raise exception 'Der Beleg liegt nicht bei dieser Ausgabe.'; end if;
  insert into crm.receipts (expense_id, path, file_name, content_type, size_bytes)
  values (p_expense, p_path, btrim(p_file_name), p_content_type, p_size) returning * into v_receipt;
  return v_receipt;
end $$;

-- Reading a statement

-- One file of camt.053 (version 02 of the German banks, or a later one): every booked entry in euro
-- of the business account named in the settings, split into its transactions when the entry carries
-- several with their own amounts. Each transaction is stored once: the key is a hash of what the bank
-- reported, with a counter for identical transactions of the same file, so loading the same or an
-- overlapping file again adds nothing. Reversals (RvslInd) stay open for Daniel with a notice.
create or replace function crm.import_bank_statement(p_file_name text, p_xml text) returns jsonb
language plpgsql as $$
declare
  v_doc xml; v_iban text; v_stmt xml; v_entry xml; v_txs xml[]; v_tx xml; v_import crm.bank_imports;
  v_index int; v_amount numeric; v_direction text; v_booking date; v_value date; v_ref text; v_name text; v_cp_iban text;
  v_purpose text; v_e2e text; v_key text; v_hash text; v_count jsonb := '{}'; v_new crm.bank_transactions; v_expected text;
  v_reversal boolean; v_reversals int := 0;
  v_entries int := 0; v_new_entries int := 0; v_skipped int := 0; v_paid int := 0; v_suggested int := 0; v_open int := 0;
  v_expenses int := 0; v_from date; v_to date; v_last date; v_stmt_entries int; v_stmt_new int;
begin
  perform crm.require_writer();
  if p_xml is null or length(p_xml) = 0 then raise exception 'Die Datei ist leer.'; end if;
  -- About 6,000 bookings; larger files would run past the time limit of one request.
  if length(p_xml) > 2097152 then raise exception 'Der Kontoauszug ist größer als 2 MB. Bitte kürzere Zeiträume einzeln herunterladen.'; end if;
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
      v_reversal := coalesce(crm.camt_text(v_entry, '/*/*[local-name()=''RvslInd'']'), '') in ('true', '1');
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
        -- The other side: the debtor of money coming in, the creditor of money going out (camt.053.001.02
        -- has the name directly below Dbtr/Cdtr, later versions below Pty).
        v_name := coalesce(
          crm.camt_text(v_tx, '/*/*[local-name()=''RltdPties'']/*[local-name()=''' || case v_direction when 'in' then 'Dbtr' else 'Cdtr' end || ''']/*[local-name()=''Nm'']'),
          crm.camt_text(v_tx, '/*/*[local-name()=''RltdPties'']/*[local-name()=''' || case v_direction when 'in' then 'Dbtr' else 'Cdtr' end || ''']/*[local-name()=''Pty'']/*[local-name()=''Nm'']'),
          '');
        v_cp_iban := upper(regexp_replace(coalesce(crm.camt_text(v_tx,
          '/*/*[local-name()=''RltdPties'']/*[local-name()=''' || case v_direction when 'in' then 'DbtrAcct' else 'CdtrAcct' end || ''']/*[local-name()=''Id'']/*[local-name()=''IBAN'']'), ''), '\s', '', 'g'));
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
          counterparty, counterparty_iban, purpose, bank_reference, reversal, status)
        values (v_import.id, v_iban, v_key, v_booking, v_value, v_direction, v_amount, v_name,
          v_cp_iban, v_purpose, left(v_ref, 120), v_reversal,
          case when v_reversal or v_direction = 'in' then 'open' else 'expense' end)
        on conflict (iban, dedupe_key) do nothing
        returning * into v_new;
        if v_new.id is not null then
          v_new_entries := v_new_entries + 1; v_stmt_new := v_stmt_new + 1;
          if v_reversal then
            v_reversals := v_reversals + 1;
            perform crm.notify_cockpit('zahlung', 'Rückbuchung: ' || crm.euro(v_amount) || case v_direction when 'in' then ' zurück aufs Konto' else ' vom Konto' end,
              coalesce(nullif(v_name, ''), 'Unbekannt') || ', ' || to_char(v_booking, 'DD.MM.YYYY') || ': „' || left(v_purpose, 160) || '“',
              'https://crm.speedofthespirit.dev/finanzen', 'wichtig', 'zahlung-' || v_new.id);
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

-- Profit per month by payment date: money in from payments to invoices and other income, money out
-- for expenses and VAT prepayments; private transfers do not count. An expense without an account yet
-- counts, because the money has left.
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
     where e.spent_on between p_from and p_to group by 1
  )
  select m.month,
         coalesce((select sum(amount) from money_in i where i.month = m.month), 0),
         coalesce((select sum(amount) from money_out o where o.month = m.month), 0),
         coalesce((select sum(open_amount) from money_out o where o.month = m.month), 0),
         coalesce((select sum(amount) from money_in i where i.month = m.month), 0)
           - coalesce((select sum(amount) from money_out o where o.month = m.month), 0)
    from months m order by m.month
$$;

-- Dunning and approvals

-- Overdue invoices step up one level at a time, at most every 7 days. A reminder goes out at once
-- when the statements reach yesterday, nothing incoming waits for a decision and the invoice was due
-- at least two days before the last statement day, so a transfer on the due date is in it. Otherwise,
-- or when the mail cannot be queued, it waits as an approval for Daniel as before.
create or replace function crm.run_dunning() returns int
language plpgsql as $$
declare
  v_invoice crm.invoices; v_count int := 0; v_level int; v_title text; v_reason text; v_waiting int := 0;
  v_until date := crm.bank_statement_until(); v_unclear int := crm.unclear_incoming(); v_auto boolean;
begin
  perform crm.require_writer();
  v_auto := coalesce(v_until >= current_date - 1, false) and v_unclear = 0;
  for v_invoice in
    select * from crm.invoices
     where status = 'open' and cancels_invoice_id is null and due_date < current_date and dunning_level < 3
       and (last_dunning_at is null or last_dunning_at <= current_date - 7)
       and not exists (select 1 from crm.approvals a where a.invoice_id = invoices.id and a.kind = 'dunning' and a.status = 'pending')
  loop
    v_level := v_invoice.dunning_level + 1;
    v_title := case v_level when 1 then 'Zahlungserinnerung' when 2 then '1. Mahnung' else '2. Mahnung' end || ' zu Rechnung ' || v_invoice.number;
    v_reason := null;
    if v_auto and v_invoice.due_date + 2 <= v_until then
      begin
        perform crm.send_dunning(v_invoice.id, v_level, null);
        perform crm.log(v_invoice.customer_id, v_title || ' verschickt; die Kontoauszüge bis ' || to_char(v_until, 'DD.MM.YYYY')
          || ' zeigen keinen Zahlungseingang.');
        v_count := v_count + 1;
        continue;
      exception when others then
        v_reason := sqlerrm;
      end;
    end if;
    insert into crm.approvals (kind, title, body, customer_id, invoice_id, payload)
    values ('dunning', v_title,
            'Offen: ' || crm.euro(v_invoice.gross - v_invoice.paid_amount) || ', fällig seit ' || to_char(v_invoice.due_date, 'DD.MM.YYYY') || '.'
            || case when v_reason is null then '' else ' Nicht von selbst verschickt: ' || v_reason end,
            v_invoice.customer_id, v_invoice.id, jsonb_build_object('level', v_level));
    if v_reason is not null then
      perform crm.log(v_invoice.customer_id, v_title || ' nicht von selbst verschickt: ' || v_reason);
    end if;
    v_waiting := v_waiting + 1;
    v_count := v_count + 1;
  end loop;
  if v_waiting > 0 and v_unclear > 0 then
    perform crm.notify_cockpit('zahlung', 'Mahnungen warten auf dich',
      v_unclear || ' Zahlungseingang/Zahlungseingänge im Kontoauszug sind noch unklar; bis sie zugeordnet sind, geht keine Mahnung von selbst raus.',
      'https://crm.speedofthespirit.dev/finanzen', 'wichtig', 'mahnung-wartet-' || to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'));
  end if;
  return v_count;
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

-- A payment suggestion rejected anywhere (decided, paid by hand, invoice cancelled) frees its transaction.
create or replace function crm.release_suggestion() returns trigger
language plpgsql as $$
begin
  if new.kind = 'payment' and old.status = 'pending' and new.status = 'rejected' and new.payload ? 'transaction_id' then
    update crm.bank_transactions set status = 'open', invoice_id = null
     where id = (new.payload ->> 'transaction_id')::uuid and status = 'suggested';
  end if;
  return new;
end $$;
drop trigger if exists release_suggestion on crm.approvals;
create trigger release_suggestion after update of status on crm.approvals for each row execute function crm.release_suggestion();

-- Receipts store: private, only the administrator; files can be added and read, never replaced or removed.
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('crm-receipts', 'crm-receipts', false, 15728640) on conflict (id) do nothing;
    drop policy if exists crm_receipts_read on storage.objects;
    create policy crm_receipts_read on storage.objects for select to authenticated
      using (bucket_id = 'crm-receipts' and public.is_admin());
    drop policy if exists crm_receipts_add on storage.objects;
    create policy crm_receipts_add on storage.objects for insert to authenticated
      with check (bucket_id = 'crm-receipts' and public.is_admin());
  end if;
end $$;

-- Rights: as everywhere in crm, the signed-in administrator works through these tables and functions.
do $$
declare t text;
begin
  foreach t in array array['expense_accounts', 'bank_imports', 'bank_transactions', 'expenses', 'account_rules', 'receipts', 'expense_changes'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('drop policy if exists admin_all on crm.%I', t);
    execute format('create policy admin_all on crm.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

grant select, insert, update, delete on crm.expense_accounts, crm.bank_imports, crm.bank_transactions, crm.expenses,
  crm.account_rules, crm.receipts, crm.expense_changes to authenticated, service_role;
-- New functions are open to everyone by default; they are for the signed-in administrator only.
revoke all on function crm.keep_receipt(), crm.guard_expense(), crm.guard_bank_transaction(), crm.log_expense_change(), crm.keep_expense_change(),
  crm.release_suggestion(), crm.payee_key(text, text), crm.is_payment_service(text), crm.real_reference(text),
  crm.camt_text(xml, text), crm.mentions_invoice(text, text), crm.bank_statement_until(), crm.unclear_incoming(), crm.open_amount(crm.invoices),
  crm.book_transaction_payment(uuid, uuid), crm.suggest_payment(crm.bank_transactions, crm.invoices, text), crm.link_payment(uuid, uuid),
  crm.unlinked_payments(numeric), crm.release_transaction(uuid), crm.assign_incoming(uuid), crm.classify_outgoing(uuid, text),
  crm.classify_incoming(uuid, text, uuid), crm.rule_account(text, text), crm.add_bank_expense(uuid),
  crm.set_expense_account(uuid, text, numeric, boolean), crm.add_cash_expense(date, numeric, text, text, text, numeric),
  crm.add_receipt(uuid, text, text, text, int), crm.import_bank_statement(text, text), crm.profit_by_month(date, date)
  from public, anon;
grant execute on function crm.keep_receipt(), crm.guard_expense(), crm.guard_bank_transaction(), crm.log_expense_change(), crm.keep_expense_change(),
  crm.release_suggestion(), crm.payee_key(text, text), crm.is_payment_service(text), crm.real_reference(text),
  crm.camt_text(xml, text), crm.mentions_invoice(text, text), crm.bank_statement_until(), crm.unclear_incoming(), crm.open_amount(crm.invoices),
  crm.book_transaction_payment(uuid, uuid), crm.suggest_payment(crm.bank_transactions, crm.invoices, text), crm.link_payment(uuid, uuid),
  crm.unlinked_payments(numeric), crm.release_transaction(uuid), crm.assign_incoming(uuid), crm.classify_outgoing(uuid, text),
  crm.classify_incoming(uuid, text, uuid), crm.rule_account(text, text), crm.add_bank_expense(uuid),
  crm.set_expense_account(uuid, text, numeric, boolean), crm.add_cash_expense(date, numeric, text, text, text, numeric),
  crm.add_receipt(uuid, text, text, text, int), crm.import_bank_statement(text, text), crm.profit_by_month(date, date)
  to authenticated, service_role;

notify pgrst, 'reload schema';
