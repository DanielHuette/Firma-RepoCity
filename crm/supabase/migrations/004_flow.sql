-- RepoCity CRM, the flow from quote to monthly service: acceptance from every channel, mails queued
-- with final text, invoices sent on their own, review requests, monthly audits and mail triage.
-- Context: builds on 001-003, cockpit 001 and RadarAuditor 006-013 (products.radar_areas,
-- public.audits.purpose, public.queue_monthly_audit, the event optimization.finished); the contract
-- is Dokumentation/INTEGRATION.md. Live order: RadarAuditor 013, this file, cockpit 002.
-- | Input: none. | Output: new columns, tables mail_texts, review_requests, audit_runs, mail_triage;
-- the functions of the flow, triggers on public.audits and public.events, crm.daily_routine for the
-- cron job crm-daily; the Anthropic key removed from Vault and from the secret functions.
-- Functions run by the service key, triggers or cockpit.run_action work without auth.uid();
-- functions for signed-in users keep crm.require_writer. Re-runnable: every statement checks first.

-- Columns

alter table crm.settings add column if not exists google_review_url text not null default '';
alter table crm.settings add column if not exists review_reminder_days int not null default 7;
alter table crm.settings drop constraint if exists settings_review_reminder_days_check;
alter table crm.settings add constraint settings_review_reminder_days_check check (review_reminder_days between 1 and 60);
alter table crm.settings drop constraint if exists settings_google_review_url_check;
alter table crm.settings add constraint settings_google_review_url_check check (google_review_url = '' or google_review_url ~ '^https://\S+$');

alter table crm.settings add column if not exists datev_consultant_number text not null default '';
alter table crm.settings add column if not exists datev_client_number text not null default '';
alter table crm.settings drop constraint if exists settings_datev_consultant_number_check;
alter table crm.settings add constraint settings_datev_consultant_number_check check (datev_consultant_number ~ '^([0-9]{1,7})?$');
alter table crm.settings drop constraint if exists settings_datev_client_number_check;
alter table crm.settings add constraint settings_datev_client_number_check check (datev_client_number ~ '^([0-9]{1,5})?$');
-- Revenue account for 0 % lines under normal taxation.
alter table crm.settings add column if not exists datev_tax_free_account text not null default '';
alter table crm.settings drop constraint if exists settings_datev_tax_free_account_check;
alter table crm.settings add constraint settings_datev_tax_free_account_check check (datev_tax_free_account ~ '^([0-9]{4})?$');

-- The customer objected to review requests (§ 7 Abs. 3 UWG); requests and reminders skip them.
alter table crm.customers add column if not exists no_review_requests boolean not null default false;

alter table crm.customers drop constraint if exists customers_source_check;
alter table crm.customers add constraint customers_source_check
  check (source in ('manual', 'website', 'phone', 'email', 'referral', 'agent', 'other', 'radarauditor'));

alter table crm.quotes add column if not exists accepted_via text;
alter table crm.quotes add column if not exists decision_note text not null default '';
alter table crm.quotes drop constraint if exists quotes_accepted_via_check;
alter table crm.quotes add constraint quotes_accepted_via_check check (accepted_via in ('app', 'email', 'phone', 'crm'));

alter table crm.subscriptions add column if not exists quote_id uuid references crm.quotes (id) on delete set null;
alter table crm.subscriptions add column if not exists unit_price_net numeric(12, 2);
alter table crm.subscriptions add column if not exists next_audit_date date;
alter table crm.subscriptions drop constraint if exists subscriptions_unit_price_net_check;
alter table crm.subscriptions add constraint subscriptions_unit_price_net_check check (unit_price_net >= 0);
create index if not exists subscriptions_audit_due on crm.subscriptions (next_audit_date) where active;

-- A monthly invoice states its service period: service_date is the first day, this the last.
alter table crm.invoices add column if not exists service_period_end date;
alter table crm.invoices drop constraint if exists invoices_service_period_check;
alter table crm.invoices add constraint invoices_service_period_check check (service_period_end >= service_date);

-- Same rule as 001, now including the end of the service period.
create or replace function crm.guard_invoice() returns trigger
language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then raise exception 'Eine festgeschriebene Rechnung kann nicht gelöscht werden. Bitte stornieren.'; end if;
    return old;
  end if;
  if old.status <> 'draft' and (
       new.number is distinct from old.number or new.customer_id is distinct from old.customer_id
    or new.issue_date is distinct from old.issue_date or new.service_date is distinct from old.service_date
    or new.service_period_end is distinct from old.service_period_end
    or new.due_date is distinct from old.due_date or new.intro is distinct from old.intro or new.outro is distinct from old.outro
    or new.net is distinct from old.net or new.vat is distinct from old.vat or new.gross is distinct from old.gross
    or new.seller_snapshot is distinct from old.seller_snapshot or new.customer_snapshot is distinct from old.customer_snapshot) then
    raise exception 'Rechnung % ist festgeschrieben und kann nicht mehr geändert werden.', old.number;
  end if;
  return new;
end $$;

alter table crm.documents add column if not exists quote_id uuid references crm.quotes (id) on delete set null;
alter table crm.documents add column if not exists invoice_id uuid references crm.invoices (id) on delete set null;

-- Tables

create table if not exists crm.mail_texts (
  key text primary key check (key in ('quote', 'invoice', 'dunning_1', 'dunning_2', 'dunning_3', 'review_request', 'review_reminder')),
  subject text not null check (length(btrim(subject)) between 1 and 300),
  body text not null check (length(body) between 1 and 20000),
  updated_at timestamptz not null default now()
);
drop trigger if exists mail_texts_touch on crm.mail_texts;
create trigger mail_texts_touch before update on crm.mail_texts for each row execute function crm.touch_updated_at();

-- Neutral texts: they name the document and nothing beyond it. The PDF is attached by the mail worker.
insert into crm.mail_texts (key, subject, body) values
('quote', 'Angebot {{nummer}}', '{{anrede}}

anbei erhalten Sie mein Angebot {{nummer}} über {{betrag}} als PDF. Es ist gültig bis zum {{faellig}}.

Mit freundlichen Grüßen
{{inhaber}}'),
('invoice', 'Rechnung {{nummer}}', '{{anrede}}

anbei erhalten Sie die Rechnung {{nummer}} über {{betrag}} als PDF. Bitte überweisen Sie den Betrag bis zum {{faellig}}.

Mit freundlichen Grüßen
{{inhaber}}'),
('dunning_1', 'Zahlungserinnerung zu Rechnung {{nummer}}', '{{anrede}}

zur Rechnung {{nummer}} ist bei mir noch kein vollständiger Zahlungseingang verbucht. Offen sind {{betrag}}. Bitte überweisen Sie den Betrag bis zum {{faellig}}. Die Zahlungserinnerung liegt als PDF bei.

Falls Sie bereits gezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.

Mit freundlichen Grüßen
{{inhaber}}'),
('dunning_2', '1. Mahnung zu Rechnung {{nummer}}', '{{anrede}}

zur Rechnung {{nummer}} ist trotz Zahlungserinnerung noch kein vollständiger Zahlungseingang verbucht. Offen sind {{betrag}}. Bitte überweisen Sie den Betrag bis zum {{faellig}}. Die Mahnung liegt als PDF bei.

Falls Sie bereits gezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.

Mit freundlichen Grüßen
{{inhaber}}'),
('dunning_3', '2. Mahnung zu Rechnung {{nummer}}', '{{anrede}}

zur Rechnung {{nummer}} ist trotz Mahnung noch kein vollständiger Zahlungseingang verbucht. Offen sind {{betrag}}. Bitte überweisen Sie den Betrag bis zum {{faellig}}. Die Mahnung liegt als PDF bei.

Falls Sie bereits gezahlt haben, betrachten Sie diese Nachricht bitte als gegenstandslos.

Mit freundlichen Grüßen
{{inhaber}}'),
('review_request', 'Bitte um eine Bewertung', '{{anrede}}

ich würde mich über eine ehrliche Bewertung Ihrer Erfahrung bei Google freuen. Hier geht es direkt zur Bewertung:
{{bewertungslink}}

Sie können solchen Anfragen jederzeit widersprechen; eine kurze Antwort auf diese E-Mail genügt. Dafür entstehen Ihnen keine anderen als die üblichen Übermittlungskosten.

Mit freundlichen Grüßen
{{inhaber}}'),
('review_reminder', 'Erinnerung: Bitte um eine Bewertung', '{{anrede}}

vor einigen Tagen hatte ich Sie um eine Bewertung bei Google gebeten. Falls Sie sich dafür noch kurz Zeit nehmen möchten, hier ist der Link:
{{bewertungslink}}

Dies ist die letzte Nachricht dazu.

Sie können solchen Anfragen jederzeit widersprechen; eine kurze Antwort auf diese E-Mail genügt. Dafür entstehen Ihnen keine anderen als die üblichen Übermittlungskosten.

Mit freundlichen Grüßen
{{inhaber}}')
on conflict (key) do nothing;

create table if not exists crm.review_requests (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references crm.customers (id) on delete cascade,
  order_id uuid not null unique references crm.orders (id) on delete cascade,
  status text not null default 'due' check (status in ('waiting_link', 'due', 'sent', 'reminded', 'done', 'cancelled')),
  sent_at timestamptz,
  reminder_due date,
  reminded_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists review_requests_open on crm.review_requests (status, reminder_due) where status in ('waiting_link', 'due', 'sent');

create table if not exists crm.audit_runs (
  id uuid primary key default gen_random_uuid(),
  subscription_id uuid not null references crm.subscriptions (id) on delete cascade,
  customer_id uuid not null references crm.customers (id) on delete cascade,
  month date not null check (month = date_trunc('month', month)::date),
  status text not null default 'due' check (status in ('due', 'started', 'reported', 'failed')),
  audit_id uuid references public.audits (id) on delete set null,
  score_before numeric,
  score_after numeric,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  unique (subscription_id, month)
);
create index if not exists audit_runs_audit on crm.audit_runs (audit_id) where audit_id is not null;
create index if not exists audit_runs_status on crm.audit_runs (status);

create table if not exists crm.mail_triage (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('unknown_sender', 'customer_mail')),
  status text not null default 'queued' check (status in ('queued', 'claimed', 'classified', 'applied', 'failed')),
  direction text not null check (direction in ('in', 'out')),
  address text not null,
  name text not null default '',
  subject text not null default '',
  body_text text not null default '' check (length(body_text) <= 8000),
  folder text not null default '',
  raw_path text,
  email_id uuid references crm.emails (id) on delete set null,
  customer_id uuid references crm.customers (id) on delete cascade,
  result jsonb,
  attempts int not null default 0,
  claimed_until timestamptz,
  error text not null default '',
  created_at timestamptz not null default now(),
  classified_at timestamptz,
  applied_at timestamptz,
  check (kind <> 'customer_mail' or customer_id is not null)
);
-- Set by the mail worker from Authentication-Results: DMARC pass, or DKIM pass for the From domain.
alter table crm.mail_triage add column if not exists sender_verified boolean not null default false;
create index if not exists mail_triage_waiting on crm.mail_triage (status, created_at) where status in ('queued', 'claimed');

alter table crm.outbox add column if not exists kind text not null default 'contract';
alter table crm.outbox add column if not exists quote_id uuid references crm.quotes (id) on delete set null;
alter table crm.outbox add column if not exists invoice_id uuid references crm.invoices (id) on delete set null;
alter table crm.outbox add column if not exists review_request_id uuid references crm.review_requests (id) on delete set null;
alter table crm.outbox add column if not exists dunning_level int;
alter table crm.outbox add column if not exists attachment_path text;
alter table crm.outbox drop constraint if exists outbox_kind_check;
-- Not valid: on a re-run, rows of the kinds later migrations add stay; 009 sets the full list again.
alter table crm.outbox add constraint outbox_kind_check
  check (kind in ('contract', 'quote', 'invoice', 'dunning', 'review_request', 'review_reminder')) not valid;
alter table crm.outbox drop constraint if exists outbox_dunning_level_check;
alter table crm.outbox add constraint outbox_dunning_level_check check (dunning_level between 1 and 3);

-- Helpers

-- A notice in the Cockpit; a missing or failing Cockpit never undoes the business step.
create or replace function crm.notify_cockpit(p_kind text, p_title text, p_body text, p_link text, p_priority text,
  p_dedupe text default null, p_actions jsonb default '[]', p_payload jsonb default '{}')
returns void
language plpgsql as $$
begin
  perform cockpit.notify_action('crm', p_kind, p_title, p_body, p_link, p_priority, p_dedupe, p_actions, p_payload, null);
exception when others then
  raise warning 'cockpit notice failed: %', sqlerrm;
end $$;

create or replace function crm.points(p_score numeric) returns text
language sql immutable as $$
  select replace(rtrim(rtrim(to_char(p_score, 'FM999990.00'), '0'), '.'), '.', ',')
$$;

create or replace function crm.mail_values(p_customer uuid, p_number text, p_amount numeric, p_due date) returns jsonb
language sql stable as $$
  select crm.base_values(p_customer, p_number, '') || jsonb_build_object(
    'nummer', p_number,
    'betrag', crm.euro(p_amount),
    'faellig', crm.date_de(p_due),
    'bewertungslink', (select google_review_url from crm.settings where id = 1))
$$;

-- Queues a mail with its final subject and body; the mail worker only attaches the PDF and sends.
create or replace function crm.queue_mail(p_kind text, p_customer uuid, p_text_key text, p_values jsonb,
  p_quote uuid default null, p_invoice uuid default null, p_review uuid default null,
  p_level int default null, p_approval uuid default null)
returns crm.outbox
language plpgsql as $$
declare v_email text; v_text crm.mail_texts; v_mail crm.outbox;
begin
  select nullif(btrim(email), '') into v_email from crm.customers where id = p_customer;
  if v_email is null then raise exception 'Beim Kunden fehlt die E-Mail-Adresse. Bitte erst in den Stammdaten eintragen.'; end if;
  select * into v_text from crm.mail_texts where key = p_text_key;
  insert into crm.outbox (customer_id, kind, to_address, subject, body, quote_id, invoice_id, review_request_id, dunning_level, approval_id)
  values (p_customer, p_kind, v_email, crm.render(v_text.subject, p_values), crm.render(v_text.body, p_values),
          p_quote, p_invoice, p_review, p_level, p_approval)
  returning * into v_mail;
  return v_mail;
end $$;

-- Contracts: queued at once when the customer has an address, otherwise an approval asks for it.

create or replace function crm.queue_contract(p_contract uuid, p_approval uuid default null) returns crm.outbox
language plpgsql as $$
declare v_contract crm.contracts; v_template crm.contract_templates; v_email text; v_mail crm.outbox;
begin
  select * into v_contract from crm.contracts where id = p_contract;
  select nullif(btrim(email), '') into v_email from crm.customers where id = v_contract.customer_id;
  if v_email is null then raise exception 'Beim Kunden fehlt die E-Mail-Adresse. Bitte erst in den Stammdaten eintragen.'; end if;
  select * into v_template from crm.contract_templates where key = v_contract.template_key;
  insert into crm.outbox (customer_id, kind, approval_id, to_address, subject, body, contract_id)
  values (v_contract.customer_id, 'contract', p_approval, v_email, v_contract.title || ' ' || v_contract.number,
          crm.render(v_template.mail_text, crm.base_values(v_contract.customer_id, v_contract.number, v_contract.title)),
          v_contract.id)
  returning * into v_mail;
  update crm.contracts set status = 'queued' where id = p_contract;
  return v_mail;
end $$;

create or replace function crm.create_contract(p_template text, p_customer uuid, p_values jsonb,
  p_subscription uuid default null, p_order uuid default null, p_start date default null, p_monthly numeric default null,
  p_number text default null)
returns crm.contracts
language plpgsql as $$
declare v_template crm.contract_templates; v_contract crm.contracts; v_number text; v_values jsonb; v_name text;
begin
  select * into v_template from crm.contract_templates where key = p_template;
  v_number := coalesce(p_number, crm.next_number('contract'));
  v_values := crm.base_values(p_customer, v_number, v_template.title) || p_values;
  insert into crm.contracts (number, customer_id, template_key, title, body, subscription_id, order_id, start_date, monthly_net)
  values (v_number, p_customer, p_template, v_template.title, crm.render(crm.render(v_template.body, v_values), v_values),
          p_subscription, p_order, p_start, p_monthly)
  returning * into v_contract;
  if exists (select 1 from crm.customers where id = p_customer and nullif(btrim(email), '') is not null) then
    perform crm.queue_contract(v_contract.id);
    perform crm.log(p_customer, v_template.title || ' ' || v_number || ' erstellt und zum Versand eingereiht.');
    select * into v_contract from crm.contracts where id = v_contract.id;
    return v_contract;
  end if;
  select name into v_name from crm.customers where id = p_customer;
  insert into crm.approvals (kind, title, body, payload, customer_id, requested_by)
  values ('contract', v_template.title || ' ' || v_number || ' an ' || v_name || ' senden',
          'Beim Kunden fehlt die E-Mail-Adresse. Bitte in den Stammdaten eintragen und dann freigeben.',
          jsonb_build_object('contract_id', v_contract.id), p_customer, 'System');
  perform crm.log(p_customer, v_template.title || ' ' || v_number || ' erstellt, wartet auf die E-Mail-Adresse.');
  return v_contract;
end $$;

create or replace function crm.contract_for_subscription() returns trigger
language plpgsql as $$
declare v_product crm.products; v_monthly numeric;
begin
  select * into v_product from crm.products where id = new.product_id;
  v_monthly := round(coalesce(new.unit_price_net, v_product.price_net) * new.quantity, 2);
  perform crm.create_contract('maintenance', new.customer_id, jsonb_build_object(
      'leistung', v_product.name || case when new.quantity <> 1 then ' (' || trim(to_char(new.quantity, 'FM999990.###')) || ' ' || v_product.unit || ')' else '' end,
      'beschreibung', v_product.description,
      'beginn', crm.date_de(new.start_date),
      'preis', crm.euro(v_monthly),
      'steuerhinweis', crm.tax_note(v_product.vat_rate)),
    new.id, null, new.start_date, v_monthly);
  return new;
end $$;

-- Products that cover catalogue areas are audited every month from one month after the start, for
-- subscriptions from a quote and those entered in the CRM alike.
create or replace function crm.set_next_audit_date() returns trigger
language plpgsql as $$
begin
  if new.next_audit_date is null
     and exists (select 1 from crm.products p where p.id = new.product_id and cardinality(p.radar_areas) > 0) then
    new.next_audit_date := (new.start_date + interval '1 month')::date;
  end if;
  return new;
end $$;
drop trigger if exists subscriptions_audit_date on crm.subscriptions;
create trigger subscriptions_audit_date before insert on crm.subscriptions for each row execute function crm.set_next_audit_date();

-- Dunning: approving queues the reminder with the open amount and a new deadline of seven days.
create or replace function crm.send_dunning(p_invoice uuid, p_level int, p_approval uuid) returns crm.outbox
language plpgsql as $$
declare v_invoice crm.invoices;
begin
  update crm.invoices set dunning_level = greatest(dunning_level, p_level), last_dunning_at = current_date
   where id = p_invoice returning * into v_invoice;
  return crm.queue_mail('dunning', v_invoice.customer_id, 'dunning_' || p_level,
    crm.mail_values(v_invoice.customer_id, v_invoice.number, v_invoice.gross - v_invoice.paid_amount, current_date + 7),
    p_invoice => v_invoice.id, p_level => p_level, p_approval => p_approval);
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

-- Quotes

create or replace function crm.channel_label(p_channel text) returns text
language sql immutable as $$
  select case p_channel when 'app' then 'in der App' when 'email' then 'per E-Mail' when 'phone' then 'am Telefon' else 'im CRM' end
$$;

create or replace function crm.check_channel(p_channel text) returns void
language plpgsql immutable as $$
begin
  if p_channel is null or p_channel not in ('app', 'email', 'phone', 'crm') then
    raise exception 'Unbekannter Weg der Entscheidung: %', coalesce(p_channel, 'leer') using errcode = '22023';
  end if;
end $$;

-- One subscription per monthly item, at the quoted price.
create or replace function crm.subscribe_monthly_items(p_quote uuid) returns void
language sql as $$
  insert into crm.subscriptions (customer_id, product_id, quantity, quote_id, unit_price_net)
  select q.customer_id, i.product_id, i.quantity, q.id, i.unit_price_net
    from crm.quote_items i join crm.products p on p.id = i.product_id join crm.quotes q on q.id = i.quote_id
   where i.quote_id = p_quote and p.billing = 'monthly'
   order by i.position
$$;

create or replace function crm.accept_quote_via(p_quote uuid, p_channel text, p_note text default '') returns crm.orders
language plpgsql as $$
declare v_quote crm.quotes; v_order crm.orders;
begin
  perform crm.require_writer();
  perform crm.check_channel(p_channel);
  update crm.quotes set status = 'accepted', decided_at = now(), accepted_via = p_channel, decision_note = left(coalesce(p_note, ''), 2000)
   where id = p_quote and status in ('draft', 'sent') returning * into v_quote;
  if v_quote.id is null then raise exception 'Dieses Angebot kann nicht mehr angenommen werden.'; end if;
  insert into crm.orders (number, customer_id, quote_id, title, due_date)
  values (crm.next_number('order'), v_quote.customer_id, v_quote.id,
          coalesce((select title from crm.deals where id = v_quote.deal_id), 'Auftrag aus ' || v_quote.number), current_date + 14)
  returning * into v_order;
  update crm.deals set stage = 'won', closed_at = now(), value_net = v_quote.net, next_step = '', next_step_due = null where id = v_quote.deal_id;
  insert into crm.tasks (title, customer_id, order_id, due_date, origin)
  values ('Auftrag ' || v_order.number || ' ausführen', v_quote.customer_id, v_order.id, v_order.due_date, 'system');
  perform crm.subscribe_monthly_items(v_quote.id);
  perform crm.log(v_quote.customer_id, 'Angebot ' || v_quote.number || ' angenommen (' || crm.channel_label(p_channel) || '), Auftrag '
                  || v_order.number || ' angelegt.' || coalesce(' Notiz: ' || nullif(btrim(p_note), ''), ''));
  return v_order;
end $$;

create or replace function crm.accept_quote(p_quote uuid) returns crm.orders
language sql as $$ select crm.accept_quote_via(p_quote, 'app') $$;

create or replace function crm.decline_quote_via(p_quote uuid, p_channel text, p_note text default '') returns crm.quotes
language plpgsql as $$
declare v_quote crm.quotes;
begin
  perform crm.require_writer();
  perform crm.check_channel(p_channel);
  update crm.quotes set status = 'declined', decided_at = now(), decision_note = left(coalesce(p_note, ''), 2000)
   where id = p_quote and status in ('draft', 'sent') returning * into v_quote;
  if v_quote.id is null then raise exception 'Dieses Angebot ist bereits entschieden.'; end if;
  update crm.deals set stage = 'lost', closed_at = now(), next_step = '', next_step_due = null where id = v_quote.deal_id;
  perform crm.log(v_quote.customer_id, 'Angebot ' || v_quote.number || ' abgelehnt (' || crm.channel_label(p_channel) || ').'
                  || coalesce(' Notiz: ' || nullif(btrim(p_note), ''), ''));
  return v_quote;
end $$;

create or replace function crm.decline_quote(p_quote uuid) returns crm.quotes
language sql as $$ select crm.decline_quote_via(p_quote, 'app') $$;

create or replace function crm.send_quote(p_quote uuid) returns crm.outbox
language plpgsql as $$
declare v_quote crm.quotes;
begin
  perform crm.require_writer();
  v_quote := crm.mark_quote_sent(p_quote);
  return crm.queue_mail('quote', v_quote.customer_id, 'quote',
    crm.mail_values(v_quote.customer_id, v_quote.number, v_quote.gross, v_quote.valid_until), p_quote => v_quote.id);
end $$;

-- Invoices

create or replace function crm.send_invoice(p_invoice uuid) returns crm.outbox
language plpgsql as $$
declare v_invoice crm.invoices;
begin
  perform crm.require_writer();
  if exists (select 1 from crm.invoices where id = p_invoice and status = 'draft') then
    perform crm.finalize_invoice(p_invoice);
  end if;
  select * into v_invoice from crm.invoices where id = p_invoice;
  if v_invoice.id is null or v_invoice.status not in ('open', 'paid') then
    raise exception 'Nur eine festgeschriebene Rechnung kann verschickt werden.';
  end if;
  return crm.queue_mail('invoice', v_invoice.customer_id, 'invoice',
    crm.mail_values(v_invoice.customer_id, v_invoice.number, v_invoice.gross, v_invoice.due_date), p_invoice => v_invoice.id);
end $$;

-- Finalises and sends; when that fails (for example missing company data) the draft stays with a
-- task and a Cockpit notice, so the caller's step is never undone.
create or replace function crm.try_send_invoice(p_invoice uuid, p_context text) returns boolean
language plpgsql as $$
declare v_invoice crm.invoices;
begin
  perform crm.send_invoice(p_invoice);
  return true;
exception when others then
  select * into v_invoice from crm.invoices where id = p_invoice;
  insert into crm.tasks (title, customer_id, order_id, invoice_id, origin)
  values (left('Rechnung ' || p_context || ' festschreiben und senden: ' || sqlerrm, 300), v_invoice.customer_id,
          v_invoice.order_id, p_invoice, 'system');
  perform crm.notify_cockpit('rechnung-offen', 'Rechnung nicht verschickt: ' || (select name from crm.customers where id = v_invoice.customer_id),
    sqlerrm, 'https://crm.speedofthespirit.dev/rechnung/' || p_invoice, 'dringend', 'rechnung-offen-' || p_invoice);
  return false;
end $$;

-- Only items that are not billed monthly; null when the quote holds nothing else. An order without
-- quote still gets an empty draft to fill in.
create or replace function crm.invoice_from_order(p_order uuid) returns crm.invoices
language plpgsql as $$
declare v_order crm.orders; v_invoice crm.invoices;
begin
  perform crm.require_writer();
  select * into v_order from crm.orders where id = p_order;
  if v_order.id is null then raise exception 'Auftrag nicht gefunden.'; end if;
  select * into v_invoice from crm.invoices where order_id = p_order and status <> 'cancelled' and cancels_invoice_id is null limit 1;
  if v_invoice.id is not null then return v_invoice; end if;
  update crm.orders set status = 'done', done_at = coalesce(done_at, now()) where id = p_order and status in ('open', 'in_progress');
  update crm.tasks set done = true, done_at = now() where order_id = p_order and not done;
  if v_order.quote_id is not null and not exists (
       select 1 from crm.quote_items i left join crm.products p on p.id = i.product_id
        where i.quote_id = v_order.quote_id and coalesce(p.billing, 'once') <> 'monthly') then
    return null;
  end if;
  insert into crm.invoices (customer_id, order_id, intro, outro)
  values (v_order.customer_id, v_order.id, 'für die erbrachten Leistungen erlaube ich mir, folgende Rechnung zu stellen:', 'Vielen Dank für Ihren Auftrag.')
  returning * into v_invoice;
  insert into crm.invoice_items (invoice_id, position, product_id, title, description, quantity, unit, unit_price_net, vat_rate)
  select v_invoice.id, i.position, i.product_id, i.title, i.description, i.quantity, i.unit, i.unit_price_net, i.vat_rate
    from crm.quote_items i left join crm.products p on p.id = i.product_id
   where i.quote_id = v_order.quote_id and coalesce(p.billing, 'once') <> 'monthly' order by i.position;
  perform crm.log(v_order.customer_id, 'Rechnungsentwurf zu Auftrag ' || v_order.number || ' angelegt.');
  select * into v_invoice from crm.invoices where id = v_invoice.id;
  return v_invoice;
end $$;

create or replace function crm.complete_order(p_order uuid) returns void
language plpgsql as $$
declare v_order crm.orders; v_invoice crm.invoices;
begin
  perform crm.require_writer();
  select * into v_order from crm.orders where id = p_order for update;
  if v_order.id is null then raise exception 'Auftrag nicht gefunden.'; end if;
  if exists (select 1 from crm.review_requests where order_id = p_order) then return; end if;
  if v_order.status in ('done', 'invoiced') then raise exception 'Auftrag % ist bereits abgeschlossen.', v_order.number; end if;
  v_invoice := crm.invoice_from_order(p_order);
  if v_invoice.id is not null and v_invoice.status = 'draft' then
    perform crm.try_send_invoice(v_invoice.id, 'zu Auftrag ' || v_order.number);
  end if;
  insert into crm.review_requests (customer_id, order_id) values (v_order.customer_id, p_order);
  perform crm.log(v_order.customer_id, 'Auftrag ' || v_order.number || ' abgeschlossen.');
end $$;

-- Monthly invoices go out on their own; the price is the quoted one or the product price.
create or replace function crm.bill_subscriptions() returns int
language plpgsql as $$
declare v_sub record; v_invoice uuid; v_count int := 0;
begin
  perform crm.require_writer();
  update crm.subscriptions set active = false where active and end_date is not null and next_invoice_date > end_date;
  update crm.contracts c set status = 'ended' from crm.subscriptions s
   where c.subscription_id = s.id and s.end_date < current_date and c.status in ('sent', 'signed', 'queued', 'draft');
  for v_sub in
    select s.*, p.name, p.description, p.unit, coalesce(s.unit_price_net, p.price_net) as price, p.vat_rate
      from crm.subscriptions s join crm.products p on p.id = s.product_id
     where s.active and s.next_invoice_date <= current_date and (s.end_date is null or s.next_invoice_date <= s.end_date)
     for update of s skip locked
  loop
    insert into crm.invoices (customer_id, intro, outro, service_date, service_period_end)
    values (v_sub.customer_id, 'für den Leistungszeitraum ' || crm.date_de(v_sub.next_invoice_date) || ' bis '
            || crm.date_de((v_sub.next_invoice_date + interval '1 month' - interval '1 day')::date) || ' berechne ich:', 'Vielen Dank.',
            v_sub.next_invoice_date, (v_sub.next_invoice_date + interval '1 month' - interval '1 day')::date)
    returning id into v_invoice;
    insert into crm.invoice_items (invoice_id, position, product_id, title, description, quantity, unit, unit_price_net, vat_rate)
    values (v_invoice, 1, v_sub.product_id, v_sub.name, v_sub.description, v_sub.quantity, v_sub.unit, v_sub.price, v_sub.vat_rate);
    update crm.subscriptions set next_invoice_date = (next_invoice_date + interval '1 month')::date where id = v_sub.id;
    perform crm.try_send_invoice(v_invoice, 'für ' || v_sub.name || ' ' || to_char(v_sub.next_invoice_date, 'MM/YYYY'));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

-- Monthly audits

create or replace function crm.flag_due_audits() returns int
language plpgsql as $$
declare v_count int;
begin
  perform crm.require_writer();
  with due as (
    update crm.subscriptions s set next_audit_date = (s.next_audit_date + interval '1 month')::date
     where s.active and s.next_audit_date <= current_date
     returning s.id, s.customer_id, date_trunc('month', s.next_audit_date - interval '1 month')::date as month
  ), runs as (
    insert into crm.audit_runs (subscription_id, customer_id, month)
    select id, customer_id, month from due
    on conflict (subscription_id, month) do nothing
    returning 1
  )
  select count(*) into v_count from runs;
  return v_count;
end $$;

create or replace function crm.start_audit_run(p_run uuid) returns crm.audit_runs
language plpgsql as $$
declare v_run crm.audit_runs; v_audit uuid;
begin
  perform crm.require_writer();
  select * into v_run from crm.audit_runs where id = p_run for update;
  if v_run.id is null then raise exception 'Monatsprüfung nicht gefunden.' using errcode = 'P0002'; end if;
  if v_run.status not in ('due', 'failed') then raise exception 'Diese Monatsprüfung läuft schon oder ist fertig.'; end if;
  v_audit := public.queue_monthly_audit(v_run.customer_id);
  update crm.audit_runs set status = 'started', audit_id = v_audit, started_at = now(), finished_at = null, score_after = null
   where id = p_run returning * into v_run;
  perform crm.log(v_run.customer_id, 'Monatsprüfung für ' || to_char(v_run.month, 'MM/YYYY') || ' gestartet.');
  return v_run;
end $$;

-- Every finished audit of a linked customer lands in the customer file; a monthly one closes its run.
create or replace function crm.on_radar_audit_finished() returns trigger
language plpgsql set search_path = '' as $$
declare v_customer uuid; v_before numeric;
begin
  select a.total_score into v_before from public.audits a
   where a.customer_id = new.customer_id and a.id <> new.id and a.status = 'reported' and a.requested_at < new.requested_at
   order by a.requested_at desc limit 1;
  update crm.audit_runs set status = new.status::text, finished_at = now(), score_before = v_before, score_after = new.total_score
   where audit_id = new.id;
  select c.crm_customer_id into v_customer from public.customers c where c.id = new.customer_id;
  if v_customer is not null then
    perform crm.log(v_customer, case when new.purpose = 'monthly' then 'Monatsprüfung' else 'Prüfung' end
      || case when new.status::text = 'reported' then ' abgeschlossen' || coalesce(': ' || crm.points(new.total_score) || ' Punkte', '') || '.'
              else ' fehlgeschlagen' || coalesce(': ' || left(nullif(new.error, ''), 300), '') || '.' end);
  end if;
  return null;
end $$;
drop trigger if exists crm_audit_finished on public.audits;
create trigger crm_audit_finished after update of status on public.audits
  for each row when (new.status::text in ('reported', 'failed') and old.status is distinct from new.status)
  execute function crm.on_radar_audit_finished();

-- The RadarAuditor finished the optimisation of an order. A failure leaves a notice instead of
-- undoing the RadarAuditor's own step.
create or replace function crm.on_radar_event() returns trigger
language plpgsql set search_path = '' as $$
begin
  perform crm.complete_order((new.payload ->> 'order_id')::uuid);
  return null;
exception when others then
  perform crm.notify_cockpit('auftrag-fehler', 'Auftrag konnte nicht abgeschlossen werden', sqlerrm,
    'https://crm.speedofthespirit.dev/verkauf', 'dringend', 'auftrag-abschluss-' || new.id);
  return null;
end $$;
drop trigger if exists crm_optimization_finished on public.events;
create trigger crm_optimization_finished after insert on public.events
  for each row when (new.kind = 'optimization.finished') execute function crm.on_radar_event();

-- Review requests

create or replace function crm.send_review_mail(p_request crm.review_requests, p_text_key text) returns void
language sql as $$
  select crm.queue_mail(p_text_key, p_request.customer_id, p_text_key,
    crm.mail_values(p_request.customer_id, (select number from crm.orders where id = p_request.order_id), null, null),
    p_review => p_request.id)
$$;

-- Customers without an address wait until one is entered.
create or replace function crm.run_review_requests() returns int
language plpgsql as $$
declare v_url text; v_days int; v_request crm.review_requests; v_count int := 0;
begin
  perform crm.require_writer();
  update crm.review_requests r set status = 'cancelled' from crm.customers c
   where c.id = r.customer_id and c.no_review_requests and r.status in ('waiting_link', 'due', 'sent');
  select google_review_url, review_reminder_days into v_url, v_days from crm.settings where id = 1;
  if v_url = '' then
    update crm.review_requests set status = 'waiting_link' where status = 'due';
    return 0;
  end if;
  for v_request in
    select r.* from crm.review_requests r join crm.customers c on c.id = r.customer_id
     where nullif(btrim(c.email), '') is not null
       and (r.status in ('due', 'waiting_link') or (r.status = 'sent' and r.reminder_due <= current_date))
     for update of r skip locked
  loop
    if v_request.status = 'sent' then
      perform crm.send_review_mail(v_request, 'review_reminder');
      update crm.review_requests set status = 'reminded', reminded_at = now() where id = v_request.id;
    else
      perform crm.send_review_mail(v_request, 'review_request');
      update crm.review_requests set status = 'sent', sent_at = now(), reminder_due = current_date + v_days where id = v_request.id;
    end if;
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function crm.mark_review_done(p_request uuid) returns crm.review_requests
language plpgsql as $$
declare v_request crm.review_requests;
begin
  perform crm.require_writer();
  update crm.review_requests set status = 'done' where id = p_request and status in ('waiting_link', 'due', 'sent', 'reminded')
  returning * into v_request;
  if v_request.id is null then raise exception 'Diese Bewertungsanfrage ist bereits abgeschlossen.'; end if;
  perform crm.log(v_request.customer_id, 'Bewertungsanfrage als erledigt markiert.');
  return v_request;
end $$;

-- Mail triage: the server worker claims rows, Claude Code classifies them, the CRM applies the result.

create or replace function crm.claim_mail_triage(p_limit int, p_seconds int) returns setof crm.mail_triage
language plpgsql as $$
begin
  if p_limit not between 1 and 50 or p_seconds not between 30 and 3600 then
    raise exception 'Ungültige Menge oder Dauer.' using errcode = '22023';
  end if;
  update crm.mail_triage set status = 'failed', claimed_until = null, error = 'Keine Antwort vom Server nach drei Versuchen.'
   where status = 'claimed' and claimed_until < now() and attempts >= 3;
  return query
  update crm.mail_triage t set status = 'claimed', attempts = t.attempts + 1, claimed_until = now() + make_interval(secs => p_seconds)
   where t.id in (select w.id from crm.mail_triage w
                   where w.status = 'queued' or (w.status = 'claimed' and w.claimed_until < now())
                   order by w.created_at limit p_limit for update skip locked)
  returning t.*;
end $$;

create or replace function crm.is_text_or_absent(p_result jsonb, p_key text, p_max int) returns boolean
language sql immutable as $$
  select not (p_result ? p_key) or jsonb_typeof(p_result -> p_key) = 'null'
      or (jsonb_typeof(p_result -> p_key) = 'string' and length(p_result ->> p_key) <= p_max)
$$;

create or replace function crm.check_triage_result(p_kind text, p_result jsonb) returns void
language plpgsql immutable as $$
declare v_ok boolean;
begin
  v_ok := jsonb_typeof(p_result) = 'object' and case p_kind
    when 'unknown_sender' then
      p_result ->> 'verdict' in ('customer', 'unsure', 'not_customer', 'automated')
      and crm.is_text_or_absent(p_result, 'name', 200) and crm.is_text_or_absent(p_result, 'company', 200)
      and crm.is_text_or_absent(p_result, 'reason', 500)
      and not exists (select 1 from jsonb_object_keys(p_result) k where k not in ('verdict', 'name', 'company', 'reason'))
    else
      p_result ->> 'intent' in ('accept', 'decline', 'other') and p_result ->> 'confidence' in ('high', 'low')
      and crm.is_text_or_absent(p_result, 'quote_number', 40) and crm.is_text_or_absent(p_result, 'summary', 500)
      and not exists (select 1 from jsonb_object_keys(p_result) k where k not in ('intent', 'quote_number', 'confidence', 'summary'))
    end;
  if not coalesce(v_ok, false) then
    raise exception 'Antwort passt nicht zum erwarteten Aufbau.' using errcode = '22023';
  end if;
end $$;

-- The customer's sent quote the mail is about: by number, or the only one when no number is named.
create or replace function crm.match_sent_quote(p_customer uuid, p_number text) returns crm.quotes
language sql stable as $$
  select q.* from crm.quotes q
   where q.customer_id = p_customer and q.status = 'sent'
     and (p_number is null or upper(q.number) = upper(btrim(p_number)))
     and (p_number is not null or (select count(*) from crm.quotes o where o.customer_id = p_customer and o.status = 'sent') = 1)
   limit 1
$$;

-- What Daniel needs to decide: the quote, whether it expired, whether the sender is proven.
create or replace function crm.triage_quote_note(p_row crm.mail_triage, p_quote crm.quotes) returns text
language sql stable as $$
  select coalesce('Angebot ' || p_quote.number
                  || case when p_quote.valid_until < current_date then ' ist am ' || crm.date_de(p_quote.valid_until) || ' abgelaufen' else '' end,
                  'Angebot nicht eindeutig')
      || case when p_row.sender_verified then '' else ' · Absender nicht bestätigt' end
$$;

create or replace function crm.notify_customer_mail(p_row crm.mail_triage, p_quote crm.quotes) returns void
language plpgsql as $$
declare v_intent text := p_row.result ->> 'intent'; v_name text; v_summary text := coalesce(nullif(btrim(p_row.result ->> 'summary'), ''), p_row.subject);
begin
  select name into v_name from crm.customers where id = p_row.customer_id;
  if v_intent = 'other' then
    perform crm.notify_cockpit('kundenmail', 'Mail von ' || v_name, v_summary,
      'https://crm.speedofthespirit.dev/kunde/' || p_row.customer_id, 'info', 'kundenmail-' || p_row.id);
    return;
  end if;
  perform crm.notify_cockpit(case v_intent when 'accept' then 'annahme' else 'kundenmail' end,
    case v_intent when 'accept' then 'Mögliche Annahme: ' else 'Mögliche Absage: ' end || v_name,
    v_summary || ' · ' || crm.triage_quote_note(p_row, p_quote),
    'https://crm.speedofthespirit.dev/' || coalesce('angebot/' || p_quote.id, 'kunde/' || p_row.customer_id), 'wichtig',
    'kundenmail-' || p_row.id,
    case when v_intent = 'accept' and p_quote.id is not null then '[{"action": "accept_quote", "title": "Annahme bestätigen"}]'::jsonb else '[]'::jsonb end,
    case when p_quote.id is not null then jsonb_build_object('quote_id', p_quote.id) else '{}'::jsonb end);
end $$;

-- Applied without Daniel only for a proven sender, a sure answer and a matched quote; an acceptance
-- also needs the quote to be still valid. Everything else becomes a notice.
create or replace function crm.apply_customer_mail(p_row crm.mail_triage) returns void
language plpgsql as $$
declare v_quote crm.quotes; v_sure boolean; v_note text := left(coalesce(nullif(btrim(p_row.result ->> 'summary'), ''), p_row.subject), 2000);
begin
  v_quote := crm.match_sent_quote(p_row.customer_id, nullif(btrim(p_row.result ->> 'quote_number'), ''));
  v_sure := p_row.sender_verified and p_row.result ->> 'confidence' = 'high' and v_quote.id is not null;
  if v_sure and p_row.result ->> 'intent' = 'accept' and v_quote.valid_until >= current_date then
    perform crm.accept_quote_via(v_quote.id, 'email', v_note);
  elsif v_sure and p_row.result ->> 'intent' = 'decline' then
    perform crm.decline_quote_via(v_quote.id, 'email', v_note);
    perform crm.notify_cockpit('kundenmail', 'Absage per E-Mail: ' || (select name from crm.customers where id = p_row.customer_id)
      || ' – ' || v_quote.number, v_note, 'https://crm.speedofthespirit.dev/angebot/' || v_quote.id, 'info', 'kundenmail-' || p_row.id);
  else
    perform crm.notify_customer_mail(p_row, v_quote);
  end if;
  perform crm.log(p_row.customer_id, 'E-Mail „' || coalesce(nullif(p_row.subject, ''), '(ohne Betreff)') || '“ ausgewertet: ' || v_note, 'email', 'Claude Code');
end $$;

create or replace function crm.classify_mail_triage(p_id uuid, p_result jsonb) returns crm.mail_triage
language plpgsql as $$
declare v_row crm.mail_triage;
begin
  select * into v_row from crm.mail_triage where id = p_id for update;
  if v_row.id is null then raise exception 'Eintrag nicht gefunden.' using errcode = 'P0002'; end if;
  if v_row.status <> 'claimed' then raise exception 'Dieser Eintrag ist nicht in Bearbeitung.' using errcode = '55000'; end if;
  perform crm.check_triage_result(v_row.kind, p_result);
  update crm.mail_triage set result = p_result, classified_at = now(), claimed_until = null, error = '',
         status = case kind when 'unknown_sender' then 'classified' else 'applied' end,
         applied_at = case kind when 'unknown_sender' then null else now() end
   where id = p_id returning * into v_row;
  if v_row.kind = 'customer_mail' then perform crm.apply_customer_mail(v_row); end if;
  return v_row;
end $$;

create or replace function crm.fail_mail_triage(p_id uuid, p_error text) returns crm.mail_triage
language plpgsql as $$
declare v_row crm.mail_triage;
begin
  update crm.mail_triage set status = case when attempts >= 3 then 'failed' else 'queued' end,
         error = left(coalesce(nullif(btrim(p_error), ''), 'Unbekannter Fehler'), 2000), claimed_until = null
   where id = p_id and status = 'claimed' returning * into v_row;
  if v_row.id is null then raise exception 'Dieser Eintrag ist nicht in Bearbeitung.' using errcode = '55000'; end if;
  return v_row;
end $$;

-- Daily routine: one step failing never stops the others; Daniel gets a notice instead.

create or replace function crm.routine_failed(p_step text, p_error text) returns void
language sql as $$
  select crm.notify_cockpit('tagesablauf', 'Tagesablauf: ' || p_step || ' fehlgeschlagen', p_error,
    'https://crm.speedofthespirit.dev/', 'dringend',
    'tagesablauf-' || p_step || '-' || to_char(now() at time zone 'Europe/Berlin', 'YYYY-MM-DD'))
$$;

create or replace function crm.daily_routine() returns void
language plpgsql as $$
begin
  perform crm.require_writer();
  begin perform crm.run_dunning(); exception when others then perform crm.routine_failed('Mahnwesen', sqlerrm); end;
  begin perform crm.bill_subscriptions(); exception when others then perform crm.routine_failed('Abo-Rechnungen', sqlerrm); end;
  begin perform crm.flag_due_audits(); exception when others then perform crm.routine_failed('Monatsprüfungen', sqlerrm); end;
  begin perform crm.run_review_requests(); exception when others then perform crm.routine_failed('Bewertungsanfragen', sqlerrm); end;
end $$;

-- Overviews

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
                                          'monthly_net', round(coalesce(s.unit_price_net, p.price_net) * s.quantity, 2), 'start_date', s.start_date,
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
    'monthly_net', (select coalesce(sum(round(coalesce(s.unit_price_net, p.price_net) * s.quantity, 2)), 0)
                      from crm.subscriptions s join crm.products p on p.id = s.product_id
                     where s.customer_id = p_customer and s.active),
    'customer_since', (select created_at from crm.customers where id = p_customer)
  )
$$;

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
    'mailbox_stale', (select exists (select 1 from crm.mail_sync where last_error <> '' or synced_at < now() - interval '1 hour')),
    'due_audits', (select count(*) from crm.audit_runs where status = 'due'),
    'mail_triage_waiting', (select count(*) from crm.mail_triage where status in ('queued', 'claimed')),
    'mail_triage_failed', (select count(*) from crm.mail_triage where status = 'failed')
  )
$$;

-- Secrets: mails are read by Claude Code on the server worker, so no Anthropic key is kept.

create or replace function crm.set_secret(p_name text, p_value text) returns void
language plpgsql security definer set search_path = '' as $$
declare v_id uuid;
begin
  if p_name not in ('crm_mail_address', 'crm_mail_password', 'crm_service_key') then
    raise exception 'Unbekannter Schlüssel %.', p_name;
  end if;
  if coalesce(p_value, '') = '' then raise exception 'Leerer Wert für %.', p_name; end if;
  select id into v_id from vault.secrets where name = p_name;
  if v_id is null then perform vault.create_secret(p_value, p_name); else perform vault.update_secret(v_id, p_value); end if;
end $$;

create or replace function crm.mail_config() returns jsonb
language sql stable security definer set search_path = '' as $$
  select coalesce(jsonb_object_agg(name, decrypted_secret), '{}'::jsonb)
    from vault.decrypted_secrets where name in ('crm_mail_address', 'crm_mail_password')
$$;

delete from vault.secrets where name = 'crm_anthropic_key';

-- Rights

do $$
declare t text;
begin
  foreach t in array array['mail_texts', 'review_requests', 'audit_runs', 'mail_triage'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('drop policy if exists admin_all on crm.%I', t);
    execute format('create policy admin_all on crm.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

grant select, insert, update, delete on crm.mail_texts, crm.review_requests, crm.audit_runs, crm.mail_triage to authenticated, service_role;
revoke all on all functions in schema crm from public, anon;
grant execute on all functions in schema crm to authenticated, service_role;
-- The form's signature of 001; migration 011 replaces it with one that also takes the link markers.
do $$
begin
  if to_regprocedure('crm.submit_inquiry(text, text, text, text, text, text)') is not null then
    grant execute on function crm.submit_inquiry(text, text, text, text, text, text) to anon;
  end if;
end $$;
revoke execute on function crm.set_secret(text, text), crm.mail_config(), crm.acquire_mail_lease(int), crm.release_mail_lease(),
  crm.intake_contact(text, text, text, text, text, text, text), crm.claim_mail_triage(int, int),
  crm.classify_mail_triage(uuid, jsonb), crm.fail_mail_triage(uuid, text) from authenticated;

-- The daily routine replaces the two statements the job ran before.
select cron.schedule('crm-daily', '0 5 * * *', $job$ select crm.daily_routine(); $job$);

notify pgrst, 'reload schema';
