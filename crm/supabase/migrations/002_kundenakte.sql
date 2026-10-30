-- RepoCity CRM, customer file: e-mails, documents, contracts from templates, outgoing mail queue.
-- Context: builds on 001_crm.sql. | Input: none. | Output: tables for the complete customer history,
-- contracts generated automatically for subscriptions and accepted quotes, a queue the mail worker
-- sends from once Daniel approved, a private file store and the overview per customer.
-- Re-runnable: every statement checks for what already exists.

-- Number range and settings

alter table crm.number_ranges drop constraint if exists number_ranges_kind_check;
alter table crm.number_ranges add constraint number_ranges_kind_check check (kind in ('invoice', 'quote', 'order', 'ticket', 'contract'));

alter table crm.settings add column if not exists contract_prefix text not null default 'VT';
alter table crm.settings add column if not exists notice_months int not null default 1;
alter table crm.settings drop constraint if exists settings_notice_months_check;
alter table crm.settings add constraint settings_notice_months_check check (notice_months between 0 and 24);

create or replace function crm.next_number(p_kind text) returns text
language plpgsql as $$
declare v_year int := extract(year from current_date)::int; v_value int; v_prefix text;
begin
  perform crm.require_writer();
  insert into crm.number_ranges (kind, year, last_value) values (p_kind, v_year, 0) on conflict do nothing;
  update crm.number_ranges set last_value = last_value + 1 where kind = p_kind and year = v_year returning last_value into v_value;
  select case p_kind when 'invoice' then invoice_prefix when 'quote' then quote_prefix when 'order' then order_prefix
                     when 'contract' then contract_prefix else 'TK' end
    into v_prefix from crm.settings where id = 1;
  return v_prefix || '-' || v_year || '-' || lpad(v_value::text, 4, '0');
end $$;

-- Customers: the mail worker fetches the history of a new or changed address once.
alter table crm.customers add column if not exists mail_backfilled boolean not null default false;

create or replace function crm.reset_mail_backfill() returns trigger
language plpgsql as $$
begin
  if lower(coalesce(new.email, '')) is distinct from lower(coalesce(old.email, '')) then new.mail_backfilled := false; end if;
  return new;
end $$;
drop trigger if exists customers_mail_backfill on crm.customers;
create trigger customers_mail_backfill before update on crm.customers for each row execute function crm.reset_mail_backfill();

-- Subscriptions can be cancelled to a date; billing stops after it.
alter table crm.subscriptions add column if not exists end_date date;
alter table crm.subscriptions add column if not exists cancelled_at timestamptz;

-- E-mails

create table if not exists crm.emails (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references crm.customers (id) on delete cascade,
  message_id text not null unique,
  direction text not null check (direction in ('in', 'out')),
  from_address text not null default '',
  from_name text not null default '',
  to_addresses text[] not null default '{}',
  cc_addresses text[] not null default '{}',
  subject text not null default '',
  body_text text not null default '',
  sent_at timestamptz not null,
  folder text not null default '',
  has_attachments boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists emails_customer on crm.emails (customer_id, sent_at desc);

create table if not exists crm.mail_sync (
  folder text primary key,
  uidvalidity bigint not null default 0,
  last_uid bigint not null default 0,
  synced_at timestamptz,
  last_error text not null default ''
);

-- Documents: uploads, mail attachments and generated contracts. Files live in the private bucket
-- crm-documents under customers/<customer id>/.
create table if not exists crm.documents (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references crm.customers (id) on delete cascade,
  kind text not null default 'other' check (kind in ('contract', 'signed_contract', 'quote', 'invoice', 'attachment', 'other')),
  title text not null check (length(btrim(title)) between 1 and 300),
  file_path text not null unique,
  mime_type text not null default 'application/octet-stream',
  size_bytes bigint not null default 0 check (size_bytes >= 0),
  source text not null default 'upload' check (source in ('upload', 'email', 'generated')),
  email_id uuid references crm.emails (id) on delete set null,
  contract_id uuid,
  created_at timestamptz not null default now()
);
create index if not exists documents_customer on crm.documents (customer_id, created_at desc);

-- Contracts

create table if not exists crm.contract_templates (
  key text primary key check (key in ('maintenance', 'order_confirmation')),
  title text not null check (length(btrim(title)) between 1 and 200),
  body text not null check (length(body) between 1 and 20000),
  mail_text text not null default '',
  needs_signature boolean not null default true,
  updated_at timestamptz not null default now()
);

insert into crm.contract_templates (key, title, needs_signature, mail_text, body) values
('maintenance', 'Wartungs- und Servicevertrag', true,
'{{anrede}}

anbei erhalten Sie den {{titel}} Nr. {{vertragsnummer}} als PDF. Bitte senden Sie mir ein unterschriebenes Exemplar zurück, gern als Scan per E-Mail.

Mit freundlichen Grüßen
{{inhaber}}',
'{{titel}} Nr. {{vertragsnummer}} vom {{datum}}

zwischen
{{firma_zeile}}
(Auftragnehmer)

und
{{kunde_zeile}}
(Auftraggeber)

§ 1 Gegenstand
Der Auftragnehmer erbringt für den Auftraggeber laufend folgende Leistung: {{leistung}}.
{{beschreibung}}

§ 2 Beginn und Laufzeit
Der Vertrag beginnt am {{beginn}} und läuft auf unbestimmte Zeit. Beide Seiten können ihn mit einer Frist von {{kuendigungsfrist}} zum Monatsende in Textform kündigen.

§ 3 Vergütung
Die monatliche Vergütung beträgt {{preis}}{{steuerhinweis}}. Sie wird monatlich berechnet und ist innerhalb von {{zahlungsziel}} Tagen nach Rechnungsstellung fällig.

§ 4 Mitwirkung
Der Auftraggeber stellt die für die Leistung nötigen Zugänge und Informationen rechtzeitig bereit.

§ 5 Haftung
Der Auftragnehmer haftet für Vorsatz und grobe Fahrlässigkeit unbeschränkt. Bei leichter Fahrlässigkeit haftet er nur bei Verletzung wesentlicher Vertragspflichten und begrenzt auf den vertragstypisch vorhersehbaren Schaden.

§ 6 Schlussbestimmungen
Änderungen und Ergänzungen bedürfen der Textform. Ist eine Bestimmung unwirksam, bleibt der Vertrag im Übrigen wirksam.


______________________________          ______________________________
Ort, Datum, Auftraggeber                {{firma}}'),
('order_confirmation', 'Auftragsbestätigung', false,
'{{anrede}}

vielen Dank für Ihren Auftrag. Anbei erhalten Sie die {{titel}} Nr. {{vertragsnummer}} als PDF.

Mit freundlichen Grüßen
{{inhaber}}',
'{{titel}} Nr. {{vertragsnummer}} vom {{datum}}

{{kunde}}
{{kunde_anschrift}}

{{anrede}}

vielen Dank für Ihren Auftrag. Hiermit bestätige ich die Annahme meines Angebots {{angebot}} über folgende Leistungen:

{{positionen}}

Gesamtbetrag: {{summe}}{{steuerhinweis}}

Geplante Fertigstellung: {{termin}}. Die Abrechnung erfolgt nach Erbringung der Leistung. Es gelten die Bedingungen des Angebots.

Mit freundlichen Grüßen
{{inhaber}}
{{firma}}')
on conflict (key) do nothing;

create table if not exists crm.contracts (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references crm.customers (id) on delete restrict,
  template_key text not null references crm.contract_templates (key),
  title text not null,
  body text not null,
  status text not null default 'draft' check (status in ('draft', 'queued', 'sent', 'signed', 'ended', 'rejected')),
  subscription_id uuid unique references crm.subscriptions (id) on delete set null,
  order_id uuid unique references crm.orders (id) on delete set null,
  start_date date,
  end_date date,
  monthly_net numeric(12, 2),
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  signed_at timestamptz
);
create index if not exists contracts_customer on crm.contracts (customer_id, created_at desc);

alter table crm.documents drop constraint if exists documents_contract_id_fkey;
alter table crm.documents add constraint documents_contract_id_fkey foreign key (contract_id) references crm.contracts (id) on delete set null;

-- Outgoing mail, sent by the mail worker only after an approval.
create table if not exists crm.outbox (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references crm.customers (id) on delete cascade,
  approval_id uuid unique references crm.approvals (id) on delete set null,
  to_address text not null,
  subject text not null,
  body text not null,
  contract_id uuid references crm.contracts (id) on delete set null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed')),
  attempts int not null default 0,
  error text not null default '',
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index if not exists outbox_queued on crm.outbox (status, created_at);

-- Template rendering

create or replace function crm.render(p_text text, p_values jsonb) returns text
language plpgsql immutable as $$
declare v_key text; v_result text := p_text;
begin
  for v_key in select jsonb_object_keys(p_values) loop
    v_result := replace(v_result, '{{' || v_key || '}}', coalesce(p_values ->> v_key, ''));
  end loop;
  return v_result;
end $$;

create or replace function crm.date_de(p_date date) returns text
language sql immutable as $$ select to_char(p_date, 'DD.MM.YYYY') $$;

-- Values every template can use: seller, customer, salutation, dates.
create or replace function crm.base_values(p_customer uuid, p_number text, p_title text) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'vertragsnummer', p_number,
    'titel', p_title,
    'datum', crm.date_de(current_date),
    'firma', s.company_name,
    'inhaber', coalesce(nullif(s.owner_name, ''), s.company_name),
    'firma_anschrift', concat_ws(', ', nullif(s.street, ''), nullif(btrim(s.postal_code || ' ' || s.city), '')),
    'kunde', c.name,
    'kunde_anschrift', concat_ws(', ', nullif(c.street, ''), nullif(btrim(c.postal_code || ' ' || c.city), '')),
    'firma_zeile', concat_ws(', ', nullif(s.company_name, ''), nullif(s.street, ''), nullif(btrim(s.postal_code || ' ' || s.city), '')),
    'kunde_zeile', concat_ws(', ', c.name, nullif(c.street, ''), nullif(btrim(c.postal_code || ' ' || c.city), '')),
    'anrede', case when c.contact_person <> '' then 'Guten Tag ' || c.contact_person || ',' else 'Sehr geehrte Damen und Herren,' end,
    'zahlungsziel', s.payment_days::text,
    'kuendigungsfrist', case s.notice_months when 0 then 'null Monaten' when 1 then 'einem Monat' else s.notice_months || ' Monaten' end
  )
  from crm.settings s, crm.customers c where s.id = 1 and c.id = p_customer
$$;

create or replace function crm.tax_note(p_rate numeric) returns text
language sql stable as $$
  select case when small_business then ' (gemäß § 19 UStG ohne Umsatzsteuer)' else ' zuzüglich ' || trim(to_char(p_rate, 'FM90')) || ' % Umsatzsteuer' end
    from crm.settings where id = 1
$$;

-- Creates the contract and the approval to send it. Called by the triggers below.
create or replace function crm.create_contract(p_template text, p_customer uuid, p_values jsonb,
  p_subscription uuid default null, p_order uuid default null, p_start date default null, p_monthly numeric default null,
  p_number text default null)
returns crm.contracts
language plpgsql as $$
declare v_template crm.contract_templates; v_contract crm.contracts; v_number text; v_values jsonb; v_email text; v_name text;
begin
  select * into v_template from crm.contract_templates where key = p_template;
  v_number := coalesce(p_number, crm.next_number('contract'));
  v_values := crm.base_values(p_customer, v_number, v_template.title) || p_values;
  insert into crm.contracts (number, customer_id, template_key, title, body, subscription_id, order_id, start_date, monthly_net)
  values (v_number, p_customer, p_template, v_template.title, crm.render(crm.render(v_template.body, v_values), v_values),
          p_subscription, p_order, p_start, p_monthly)
  returning * into v_contract;
  select email, name into v_email, v_name from crm.customers where id = p_customer;
  insert into crm.approvals (kind, title, body, payload, customer_id, requested_by)
  values ('contract', v_template.title || ' ' || v_number || ' an ' || v_name || ' senden',
          case when coalesce(v_email, '') = '' then 'Beim Kunden fehlt die E-Mail-Adresse. Bitte erst in den Stammdaten eintragen.'
               else 'Geht als PDF per E-Mail an ' || v_email || '.' end,
          jsonb_build_object('contract_id', v_contract.id), p_customer, 'System');
  perform crm.log(p_customer, v_template.title || ' ' || v_number || ' erstellt, wartet auf Freigabe.');
  return v_contract;
end $$;

create or replace function crm.contract_for_subscription() returns trigger
language plpgsql as $$
declare v_product crm.products;
begin
  select * into v_product from crm.products where id = new.product_id;
  perform crm.create_contract('maintenance', new.customer_id, jsonb_build_object(
      'leistung', v_product.name || case when new.quantity <> 1 then ' (' || trim(to_char(new.quantity, 'FM999990.###')) || ' ' || v_product.unit || ')' else '' end,
      'beschreibung', v_product.description,
      'beginn', crm.date_de(new.start_date),
      'preis', crm.euro(round(v_product.price_net * new.quantity, 2)),
      'steuerhinweis', crm.tax_note(v_product.vat_rate)),
    new.id, null, new.start_date, round(v_product.price_net * new.quantity, 2));
  return new;
end $$;
drop trigger if exists subscriptions_contract on crm.subscriptions;
create trigger subscriptions_contract after insert on crm.subscriptions for each row execute function crm.contract_for_subscription();

create or replace function crm.contract_for_order() returns trigger
language plpgsql as $$
declare v_quote crm.quotes; v_lines text; v_rate numeric;
begin
  if new.quote_id is null then return new; end if;
  select * into v_quote from crm.quotes where id = new.quote_id;
  select string_agg('- ' || title || ': ' || trim(to_char(quantity, 'FM999990.###')) || ' ' || unit || ' × ' || crm.euro(unit_price_net)
                    || ' = ' || crm.euro(round(quantity * unit_price_net, 2)), E'\n' order by position), max(vat_rate)
    into v_lines, v_rate from crm.quote_items where quote_id = new.quote_id;
  perform crm.create_contract('order_confirmation', new.customer_id, jsonb_build_object(
      'angebot', v_quote.number,
      'positionen', coalesce(v_lines, ''),
      'summe', crm.euro(v_quote.gross),
      'steuerhinweis', case when (select small_business from crm.settings where id = 1) then ' (gemäß § 19 UStG ohne Umsatzsteuer)' else ' inklusive Umsatzsteuer' end,
      'termin', coalesce(crm.date_de(new.due_date), 'nach Absprache')),
    null, new.id, current_date, null, new.number);
  return new;
end $$;
drop trigger if exists orders_contract on crm.orders;
create trigger orders_contract after insert on crm.orders for each row execute function crm.contract_for_order();

-- Approving a contract puts the mail into the outbox; the worker sends it with the PDF.
create or replace function crm.decide_approval(p_approval uuid, p_approve boolean) returns crm.approvals
language plpgsql as $$
declare v_approval crm.approvals; v_level int; v_contract crm.contracts; v_template crm.contract_templates; v_email text;
begin
  perform crm.require_writer();
  update crm.approvals set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now()
   where id = p_approval and status = 'pending' returning * into v_approval;
  if v_approval.id is null then raise exception 'Diese Freigabe ist bereits entschieden.'; end if;
  if p_approve and v_approval.kind = 'dunning' and v_approval.invoice_id is not null then
    v_level := coalesce((v_approval.payload ->> 'level')::int, 1);
    update crm.invoices set dunning_level = greatest(dunning_level, v_level), last_dunning_at = current_date where id = v_approval.invoice_id;
  end if;
  if v_approval.kind = 'contract' and v_approval.payload ? 'contract_id' then
    select * into v_contract from crm.contracts where id = (v_approval.payload ->> 'contract_id')::uuid;
    if p_approve then
      select email into v_email from crm.customers where id = v_contract.customer_id;
      if coalesce(v_email, '') = '' then raise exception 'Beim Kunden fehlt die E-Mail-Adresse. Bitte erst in den Stammdaten eintragen.'; end if;
      select * into v_template from crm.contract_templates where key = v_contract.template_key;
      insert into crm.outbox (customer_id, approval_id, to_address, subject, body, contract_id)
      values (v_contract.customer_id, v_approval.id, v_email, v_contract.title || ' ' || v_contract.number,
              crm.render(v_template.mail_text, crm.base_values(v_contract.customer_id, v_contract.number, v_contract.title)), v_contract.id);
      update crm.contracts set status = 'queued' where id = v_contract.id;
    else
      update crm.contracts set status = 'rejected' where id = v_contract.id and status = 'draft';
    end if;
  end if;
  perform crm.log(v_approval.customer_id, 'Freigabe „' || v_approval.title || '“ ' || case when p_approve then 'erteilt' else 'abgelehnt' end || '.');
  return v_approval;
end $$;

create or replace function crm.mark_contract_signed(p_contract uuid) returns crm.contracts
language plpgsql as $$
declare v_contract crm.contracts;
begin
  perform crm.require_writer();
  update crm.contracts set status = 'signed', signed_at = now() where id = p_contract and status in ('draft', 'queued', 'sent')
  returning * into v_contract;
  if v_contract.id is null then raise exception 'Dieser Vertrag kann nicht als unterschrieben markiert werden.'; end if;
  perform crm.log(v_contract.customer_id, v_contract.title || ' ' || v_contract.number || ' ist unterschrieben.');
  return v_contract;
end $$;

-- Cancellation: billing runs up to the end date, the contract ends with it.
create or replace function crm.cancel_subscription(p_subscription uuid, p_end date) returns crm.subscriptions
language plpgsql as $$
declare v_sub crm.subscriptions;
begin
  perform crm.require_writer();
  if p_end is null then raise exception 'Bitte ein Enddatum angeben.'; end if;
  update crm.subscriptions set end_date = p_end, cancelled_at = now(), active = p_end >= current_date
   where id = p_subscription and end_date is null returning * into v_sub;
  if v_sub.id is null then raise exception 'Dieses Abo ist bereits gekündigt.'; end if;
  update crm.contracts set end_date = p_end, status = case when p_end < current_date then 'ended' else status end where subscription_id = v_sub.id;
  perform crm.log(v_sub.customer_id, 'Abo gekündigt zum ' || crm.date_de(p_end) || '.');
  return v_sub;
end $$;

create or replace function crm.bill_subscriptions() returns int
language plpgsql as $$
declare v_sub record; v_invoice uuid; v_count int := 0;
begin
  perform crm.require_writer();
  update crm.subscriptions set active = false where active and end_date is not null and next_invoice_date > end_date;
  update crm.contracts c set status = 'ended' from crm.subscriptions s
   where c.subscription_id = s.id and s.end_date < current_date and c.status in ('sent', 'signed', 'queued', 'draft');
  for v_sub in
    select s.*, p.name, p.description, p.unit, p.price_net, p.vat_rate
      from crm.subscriptions s join crm.products p on p.id = s.product_id
     where s.active and s.next_invoice_date <= current_date and (s.end_date is null or s.next_invoice_date <= s.end_date)
  loop
    insert into crm.invoices (customer_id, intro, outro, service_date)
    values (v_sub.customer_id, 'für den Leistungszeitraum ' || to_char(v_sub.next_invoice_date, 'MM/YYYY') || ' berechne ich:', 'Vielen Dank.', v_sub.next_invoice_date)
    returning id into v_invoice;
    insert into crm.invoice_items (invoice_id, position, product_id, title, description, quantity, unit, unit_price_net, vat_rate)
    values (v_invoice, 1, v_sub.product_id, v_sub.name, v_sub.description, v_sub.quantity, v_sub.unit, v_sub.price_net, v_sub.vat_rate);
    update crm.subscriptions set next_invoice_date = (next_invoice_date + interval '1 month')::date where id = v_sub.id;
    insert into crm.tasks (title, customer_id, invoice_id, origin) values ('Abo-Rechnung prüfen und festschreiben', v_sub.customer_id, v_invoice, 'system');
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- One intake for every channel (mail worker, website shop, telephone assistant; service key only):
-- finds or creates the customer by e-mail address and optionally files an inquiry with a task.
create or replace function crm.intake_contact(p_channel text, p_email text, p_name text, p_company text default '',
  p_phone text default '', p_subject text default null, p_message text default null) returns uuid
language plpgsql as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_customer uuid;
  v_name text;
  v_source text := case when p_channel in ('website', 'phone', 'email', 'agent', 'referral') then p_channel else 'other' end;
begin
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'Ungültige E-Mail-Adresse.'; end if;
  select id into v_customer from crm.customers where lower(email) = v_email;
  if v_customer is null then
    v_name := left(coalesce(nullif(btrim(p_company), ''), nullif(btrim(p_name), ''), split_part(v_email, '@', 1)), 200);
    insert into crm.customers (kind, name, contact_person, email, phone, source, mail_backfilled)
    values (case when btrim(coalesce(p_company, '')) = '' then 'person' else 'company' end, v_name,
            case when btrim(coalesce(p_company, '')) = '' then '' else left(btrim(coalesce(p_name, '')), 200) end,
            v_email, left(btrim(coalesce(p_phone, '')), 60), v_source, false)
    returning id into v_customer;
    perform crm.log(v_customer, 'Kunde automatisch angelegt (' || case v_source when 'email' then 'E-Mail' when 'phone' then 'Telefon'
                                when 'website' then 'Webseite' else 'Agent' end || ').', 'system', 'Aufnahme');
  end if;
  if p_subject is not null then
    insert into crm.inquiries (customer_id, channel, subject, message)
    values (v_customer, case when v_source in ('website', 'phone', 'email', 'agent', 'referral') then v_source else 'other' end,
            left(coalesce(nullif(btrim(p_subject), ''), 'Anfrage'), 200), left(coalesce(p_message, ''), 5000));
    insert into crm.tasks (title, customer_id, origin)
    values ('Anfrage von ' || (select name from crm.customers where id = v_customer) || ' beantworten', v_customer, 'agent');
  end if;
  return v_customer;
end $$;

-- Senders the worker did not file as customers. Nothing is thrown away by the model: every unknown
-- address waits here until Daniel decides; only his "kein Kunde" puts an address on the ignore list.
create table if not exists crm.mail_review (
  id uuid primary key default gen_random_uuid(),
  address text not null unique,
  name text not null default '',
  company text not null default '',
  direction text not null check (direction in ('in', 'out')),
  subject text not null default '',
  snippet text not null default '',
  sent_at timestamptz not null,
  mail_count int not null default 1,
  verdict text not null check (verdict in ('unsure', 'not_customer', 'automated')),
  reason text not null default '',
  status text not null default 'open' check (status in ('open', 'customer', 'ignored')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);
create index if not exists mail_review_open on crm.mail_review (status, verdict, sent_at desc);

create table if not exists crm.mail_ignore (
  address text primary key,
  created_at timestamptz not null default now()
);

-- Runs with owner rights because the intake is closed to signed-in users; require_writer guards it.
create or replace function crm.decide_mail_review(p_review uuid, p_customer boolean) returns uuid
language plpgsql security definer set search_path = crm, public as $$
declare v_review crm.mail_review; v_customer uuid;
begin
  perform crm.require_writer();
  update crm.mail_review set status = case when p_customer then 'customer' else 'ignored' end, decided_at = now()
   where id = p_review and status = 'open' returning * into v_review;
  if v_review.id is null then raise exception 'Dieser Absender ist bereits entschieden.'; end if;
  if p_customer then
    v_customer := crm.intake_contact('email', v_review.address, v_review.name, v_review.company, '',
                                     case when v_review.direction = 'in' then v_review.subject else null end,
                                     case when v_review.direction = 'in' then v_review.snippet else null end);
  else
    insert into crm.mail_ignore (address) values (v_review.address) on conflict do nothing;
  end if;
  return v_customer;
end $$;

-- Removes a customer created by mistake, as long as nothing commercial exists for them.
create or replace function crm.dismiss_customer(p_customer uuid) returns void
language plpgsql as $$
declare v_email text;
begin
  perform crm.require_writer();
  if exists (select 1 from crm.quotes where customer_id = p_customer) or exists (select 1 from crm.invoices where customer_id = p_customer)
     or exists (select 1 from crm.orders where customer_id = p_customer) or exists (select 1 from crm.subscriptions where customer_id = p_customer)
     or exists (select 1 from crm.contracts where customer_id = p_customer) then
    raise exception 'Für diesen Kunden gibt es schon Angebote, Aufträge, Rechnungen oder Verträge. Er bleibt deshalb erhalten.';
  end if;
  select lower(email) into v_email from crm.customers where id = p_customer;
  delete from crm.tasks where customer_id = p_customer;
  delete from crm.approvals where customer_id = p_customer;
  delete from crm.customers where id = p_customer;
  if coalesce(v_email, '') <> '' then insert into crm.mail_ignore (address) values (v_email) on conflict do nothing; end if;
end $$;

-- Overview per customer: what was bought when, running subscriptions, contracts, money.
create or replace function crm.customer_overview(p_customer uuid) returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'purchases', coalesce((
      select jsonb_agg(jsonb_build_object('date', i.issue_date, 'title', it.title, 'quantity', it.quantity, 'unit', it.unit,
                                          'net', round(it.quantity * it.unit_price_net, 2), 'invoice_id', i.id, 'invoice_number', i.number,
                                          'cancelled', i.status = 'cancelled' or i.cancels_invoice_id is not null)
                       order by i.issue_date desc, it.position)
        from crm.invoices i join crm.invoice_items it on it.invoice_id = i.id
       where i.customer_id = p_customer and i.status <> 'draft'), '[]'::jsonb),
    'subscriptions', coalesce((
      select jsonb_agg(jsonb_build_object('id', s.id, 'product', p.name, 'quantity', s.quantity, 'unit', p.unit,
                                          'monthly_net', round(p.price_net * s.quantity, 2), 'start_date', s.start_date,
                                          'next_invoice_date', s.next_invoice_date, 'end_date', s.end_date, 'active', s.active,
                                          'contract_id', c.id, 'contract_number', c.number, 'contract_status', c.status)
                       order by s.active desc, s.start_date desc)
        from crm.subscriptions s join crm.products p on p.id = s.product_id left join crm.contracts c on c.subscription_id = s.id
       where s.customer_id = p_customer), '[]'::jsonb),
    'contracts', coalesce((
      select jsonb_agg(jsonb_build_object('id', id, 'number', number, 'title', title, 'status', status, 'start_date', start_date,
                                          'end_date', end_date, 'created_at', created_at, 'sent_at', sent_at, 'signed_at', signed_at)
                       order by created_at desc)
        from crm.contracts where customer_id = p_customer), '[]'::jsonb),
    'revenue_net', (select coalesce(sum(net), 0) from crm.invoices where customer_id = p_customer and status in ('open', 'paid')),
    'open_amount', (select coalesce(sum(gross - paid_amount), 0) from crm.invoices where customer_id = p_customer and status = 'open' and cancels_invoice_id is null),
    'monthly_net', (select coalesce(sum(round(p.price_net * s.quantity, 2)), 0) from crm.subscriptions s join crm.products p on p.id = s.product_id
                     where s.customer_id = p_customer and s.active),
    'customer_since', (select created_at from crm.customers where id = p_customer)
  )
$$;

-- Start page figures, extended by the mailbox: unknown senders waiting, mails that failed to go out,
-- and a mailbox that has not been read for an hour.
create or replace function crm.today_overview() returns jsonb
language sql stable as $$
  select jsonb_build_object(
    'new_inquiries', (select count(*) from crm.inquiries where status = 'new'),
    'due_deals', (select count(*) from crm.deals where stage not in ('won', 'lost') and next_step_due <= current_date),
    'expiring_quotes', (select count(*) from crm.quotes where status = 'sent' and valid_until <= current_date + 7),
    'open_orders', (select count(*) from crm.orders where status in ('open', 'in_progress')),
    'draft_invoices', (select count(*) from crm.invoices where status = 'draft'),
    'overdue_invoices', (select count(*) from crm.invoices where status = 'open' and cancels_invoice_id is null and due_date < current_date),
    'pending_approvals', (select count(*) from crm.approvals where status = 'pending'),
    'open_tickets', (select count(*) from crm.tickets where status <> 'solved'),
    'tasks_due', (select count(*) from crm.tasks where not done and due_date <= current_date),
    'receivables', (select coalesce(sum(gross - paid_amount), 0) from crm.invoices where status = 'open' and cancels_invoice_id is null),
    'paid_this_month', (select coalesce(sum(amount), 0) from crm.payments where date_trunc('month', paid_on) = date_trunc('month', current_date)),
    'open_quotes_value', (select coalesce(sum(net), 0) from crm.quotes where status = 'sent'),
    'pipeline_value', (select coalesce(sum(value_net), 0) from crm.deals where stage not in ('won', 'lost')),
    'unknown_senders', (select count(*) from crm.mail_review where status = 'open' and verdict <> 'automated'),
    'failed_mails', (select count(*) from crm.outbox where status = 'failed'),
    'mailbox_stale', (select exists (select 1 from crm.mail_sync where last_error <> '' or synced_at < now() - interval '1 hour'))
  )
$$;

-- Rights

do $$
declare t text;
begin
  foreach t in array array['emails', 'mail_sync', 'documents', 'contract_templates', 'contracts', 'outbox', 'mail_review', 'mail_ignore'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('drop policy if exists admin_all on crm.%I', t);
    execute format('create policy admin_all on crm.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

grant select, insert, update, delete on all tables in schema crm to authenticated, service_role;
grant execute on all functions in schema crm to authenticated, service_role;
revoke execute on function crm.intake_contact(text, text, text, text, text, text, text) from authenticated, anon, public;
grant execute on function crm.intake_contact(text, text, text, text, text, text, text) to service_role;

-- Private file store, only for the administrator (the worker uses the service key).
do $$
begin
  if exists (select 1 from pg_namespace where nspname = 'storage') then
    insert into storage.buckets (id, name, public, file_size_limit)
    values ('crm-documents', 'crm-documents', false, 26214400) on conflict (id) do nothing;
    drop policy if exists crm_documents_admin on storage.objects;
    create policy crm_documents_admin on storage.objects for all to authenticated
      using (bucket_id = 'crm-documents' and public.is_admin()) with check (bucket_id = 'crm-documents' and public.is_admin());
  end if;
end $$;

notify pgrst, 'reload schema';
