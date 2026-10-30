-- RepoCity CRM: customers, sales and invoicing for a one-person business with agents.
-- Context: own schema "crm" in the shared Supabase project; builds on public.is_admin() from the
-- RadarAuditor roles migration. | Input: none. | Output: tables, number ranges, totals, the chain
-- inquiry -> deal -> quote -> order -> invoice -> payment -> dunning, approvals for agents.
-- Finalised invoices are immutable (GoBD): corrections happen through a cancellation invoice.

create schema if not exists crm;
create extension if not exists pgcrypto;

-- Company data printed on quotes and invoices. Exactly one row.
create table if not exists crm.settings (
  id int primary key default 1 check (id = 1),
  company_name text not null default '',
  owner_name text not null default '',
  street text not null default '',
  postal_code text not null default '',
  city text not null default '',
  country_code text not null default 'DE',
  email text not null default '',
  phone text not null default '',
  website text not null default '',
  tax_number text not null default '',
  vat_id text not null default '',
  iban text not null default '',
  bic text not null default '',
  bank_name text not null default '',
  small_business boolean not null default true,
  payment_days int not null default 14 check (payment_days between 0 and 120),
  quote_valid_days int not null default 30 check (quote_valid_days between 1 and 365),
  invoice_prefix text not null default 'RE',
  quote_prefix text not null default 'AN',
  order_prefix text not null default 'AU',
  updated_at timestamptz not null default now()
);
insert into crm.settings (id) values (1) on conflict (id) do nothing;

create table if not exists crm.number_ranges (
  kind text not null check (kind in ('invoice', 'quote', 'order', 'ticket')),
  year int not null,
  last_value int not null default 0,
  primary key (kind, year)
);

create table if not exists crm.customers (
  id uuid primary key default gen_random_uuid(),
  kind text not null default 'company' check (kind in ('company', 'person')),
  name text not null check (length(btrim(name)) between 1 and 200),
  contact_person text not null default '',
  email text,
  phone text not null default '',
  street text not null default '',
  postal_code text not null default '',
  city text not null default '',
  country_code text not null default 'DE',
  vat_id text not null default '',
  buyer_reference text not null default '',
  source text not null default 'manual' check (source in ('manual', 'website', 'phone', 'email', 'referral', 'agent', 'other')),
  marketing_consent boolean not null default false,
  notes text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists customers_email_unique on crm.customers (lower(email)) where email is not null and email <> '';

create table if not exists crm.inquiries (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references crm.customers (id) on delete cascade,
  channel text not null default 'website' check (channel in ('website', 'phone', 'email', 'chat', 'referral', 'agent', 'other')),
  subject text not null default '',
  message text not null default '',
  status text not null default 'new' check (status in ('new', 'in_progress', 'done', 'rejected')),
  created_at timestamptz not null default now()
);

create table if not exists crm.deals (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references crm.customers (id) on delete cascade,
  inquiry_id uuid references crm.inquiries (id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 200),
  stage text not null default 'new' check (stage in ('new', 'meeting', 'quote', 'won', 'lost')),
  value_net numeric(12, 2) not null default 0 check (value_net >= 0),
  next_step text not null default '',
  next_step_due date,
  created_at timestamptz not null default now(),
  closed_at timestamptz
);

create table if not exists crm.products (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 200),
  description text not null default '',
  unit text not null default 'Stück',
  price_net numeric(12, 2) not null default 0 check (price_net >= 0),
  vat_rate numeric(4, 2) not null default 19 check (vat_rate in (0, 7, 19)),
  billing text not null default 'once' check (billing in ('once', 'monthly')),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists crm.quotes (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references crm.customers (id) on delete restrict,
  deal_id uuid references crm.deals (id) on delete set null,
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined', 'expired')),
  issue_date date not null default current_date,
  valid_until date not null default current_date + 30,
  intro text not null default '',
  outro text not null default '',
  net numeric(12, 2) not null default 0,
  vat numeric(12, 2) not null default 0,
  gross numeric(12, 2) not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  decided_at timestamptz
);

create table if not exists crm.quote_items (
  id uuid primary key default gen_random_uuid(),
  quote_id uuid not null references crm.quotes (id) on delete cascade,
  position int not null default 1,
  product_id uuid references crm.products (id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 300),
  description text not null default '',
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  unit text not null default 'Stück',
  unit_price_net numeric(12, 2) not null default 0,
  vat_rate numeric(4, 2) not null default 19 check (vat_rate in (0, 7, 19))
);

create table if not exists crm.orders (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid not null references crm.customers (id) on delete restrict,
  quote_id uuid unique references crm.quotes (id) on delete set null,
  title text not null default '',
  status text not null default 'open' check (status in ('open', 'in_progress', 'done', 'invoiced')),
  due_date date,
  created_at timestamptz not null default now(),
  done_at timestamptz
);

create table if not exists crm.invoices (
  id uuid primary key default gen_random_uuid(),
  number text unique,
  customer_id uuid not null references crm.customers (id) on delete restrict,
  order_id uuid references crm.orders (id) on delete set null,
  cancels_invoice_id uuid references crm.invoices (id) on delete restrict,
  status text not null default 'draft' check (status in ('draft', 'open', 'paid', 'cancelled')),
  issue_date date,
  service_date date,
  due_date date,
  intro text not null default '',
  outro text not null default '',
  net numeric(12, 2) not null default 0,
  vat numeric(12, 2) not null default 0,
  gross numeric(12, 2) not null default 0,
  paid_amount numeric(12, 2) not null default 0,
  dunning_level int not null default 0 check (dunning_level between 0 and 3),
  last_dunning_at date,
  seller_snapshot jsonb,
  customer_snapshot jsonb,
  created_at timestamptz not null default now(),
  finalized_at timestamptz,
  paid_at timestamptz
);

create table if not exists crm.invoice_items (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references crm.invoices (id) on delete cascade,
  position int not null default 1,
  product_id uuid references crm.products (id) on delete set null,
  title text not null check (length(btrim(title)) between 1 and 300),
  description text not null default '',
  quantity numeric(12, 3) not null default 1 check (quantity <> 0),
  unit text not null default 'Stück',
  unit_price_net numeric(12, 2) not null default 0,
  vat_rate numeric(4, 2) not null default 19 check (vat_rate in (0, 7, 19))
);

create table if not exists crm.payments (
  id uuid primary key default gen_random_uuid(),
  invoice_id uuid not null references crm.invoices (id) on delete restrict,
  amount numeric(12, 2) not null check (amount > 0),
  paid_on date not null default current_date,
  method text not null default 'transfer' check (method in ('transfer', 'cash', 'paypal', 'card', 'other')),
  reference text not null default '',
  created_at timestamptz not null default now()
);

create table if not exists crm.tickets (
  id uuid primary key default gen_random_uuid(),
  number text not null unique,
  customer_id uuid references crm.customers (id) on delete set null,
  subject text not null check (length(btrim(subject)) between 1 and 300),
  body text not null default '',
  status text not null default 'open' check (status in ('open', 'waiting', 'solved')),
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high')),
  created_at timestamptz not null default now(),
  solved_at timestamptz
);

create table if not exists crm.tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(btrim(title)) between 1 and 300),
  due_date date not null default current_date,
  done boolean not null default false,
  done_at timestamptz,
  customer_id uuid references crm.customers (id) on delete cascade,
  deal_id uuid references crm.deals (id) on delete cascade,
  order_id uuid references crm.orders (id) on delete cascade,
  invoice_id uuid references crm.invoices (id) on delete cascade,
  ticket_id uuid references crm.tickets (id) on delete cascade,
  origin text not null default 'person' check (origin in ('person', 'system', 'agent')),
  created_at timestamptz not null default now()
);

create table if not exists crm.activities (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid references crm.customers (id) on delete cascade,
  kind text not null default 'note' check (kind in ('note', 'call', 'email', 'meeting', 'system')),
  body text not null check (length(btrim(body)) between 1 and 5000),
  actor text not null default 'Daniel',
  happened_at timestamptz not null default now()
);

create table if not exists crm.subscriptions (
  id uuid primary key default gen_random_uuid(),
  customer_id uuid not null references crm.customers (id) on delete restrict,
  product_id uuid not null references crm.products (id) on delete restrict,
  quantity numeric(12, 3) not null default 1 check (quantity > 0),
  start_date date not null default current_date,
  next_invoice_date date not null default current_date,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists crm.approvals (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('dunning', 'publication', 'quote', 'invoice', 'payment', 'contract', 'other')),
  title text not null check (length(btrim(title)) between 1 and 300),
  body text not null default '',
  payload jsonb not null default '{}'::jsonb,
  customer_id uuid references crm.customers (id) on delete cascade,
  invoice_id uuid references crm.invoices (id) on delete cascade,
  requested_by text not null default 'System',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  created_at timestamptz not null default now(),
  decided_at timestamptz
);

create index if not exists inquiries_status on crm.inquiries (status, created_at desc);
create index if not exists deals_stage on crm.deals (stage);
create index if not exists quotes_customer on crm.quotes (customer_id);
create index if not exists invoices_status on crm.invoices (status, due_date);
create index if not exists invoices_customer on crm.invoices (customer_id);
create index if not exists tasks_open on crm.tasks (done, due_date);
create index if not exists activities_customer on crm.activities (customer_id, happened_at desc);
create index if not exists approvals_pending on crm.approvals (status, created_at desc);

create or replace function crm.require_writer() returns void
language plpgsql as $$
begin
  if auth.uid() is not null and not public.is_admin() then
    raise exception 'Nur der Administrator darf das.';
  end if;
end $$;

create or replace function crm.euro(p_amount numeric) returns text
language sql immutable as $$ select translate(to_char(p_amount, 'FM999G999G990D00'), ',.', '.,') || ' €' $$;

-- Gapless per kind and year: the row lock serialises concurrent callers.
create or replace function crm.next_number(p_kind text) returns text
language plpgsql as $$
declare
  v_year int := extract(year from current_date)::int;
  v_value int;
  v_prefix text;
begin
  perform crm.require_writer();
  insert into crm.number_ranges (kind, year, last_value) values (p_kind, v_year, 0) on conflict do nothing;
  update crm.number_ranges set last_value = last_value + 1 where kind = p_kind and year = v_year returning last_value into v_value;
  select case p_kind when 'invoice' then invoice_prefix when 'quote' then quote_prefix when 'order' then order_prefix else 'TK' end
    into v_prefix from crm.settings where id = 1;
  return format('%s-%s-%s', v_prefix, v_year, lpad(v_value::text, 4, '0'));
end $$;

-- VAT is rounded per rate, as on the printed document.
create or replace function crm.document_totals(p_items jsonb, p_small_business boolean)
returns table (net numeric, vat numeric, gross numeric)
language sql immutable as $$
  with lines as (
    select (i ->> 'vat_rate')::numeric as rate,
           round((i ->> 'quantity')::numeric * (i ->> 'unit_price_net')::numeric, 2) as amount
      from jsonb_array_elements(coalesce(p_items, '[]'::jsonb)) i
  ), groups as (
    select rate, sum(amount) as amount from lines group by rate
  )
  select coalesce(sum(amount), 0)::numeric(12, 2),
         case when p_small_business then 0 else coalesce(sum(round(amount * rate / 100, 2)), 0) end::numeric(12, 2),
         (coalesce(sum(amount), 0) + case when p_small_business then 0 else coalesce(sum(round(amount * rate / 100, 2)), 0) end)::numeric(12, 2)
    from groups
$$;

create or replace function crm.refresh_quote_totals() returns trigger
language plpgsql as $$
declare v_id uuid := coalesce(new.quote_id, old.quote_id);
begin
  update crm.quotes q set (net, vat, gross) = (
    select t.net, t.vat, t.gross from crm.document_totals(
      (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from crm.quote_items i where i.quote_id = v_id),
      (select small_business from crm.settings where id = 1)) t)
   where q.id = v_id;
  return null;
end $$;
drop trigger if exists quote_items_totals on crm.quote_items;
create trigger quote_items_totals after insert or update or delete on crm.quote_items
  for each row execute function crm.refresh_quote_totals();

create or replace function crm.refresh_invoice_totals() returns trigger
language plpgsql as $$
declare v_id uuid := coalesce(new.invoice_id, old.invoice_id);
begin
  update crm.invoices v set (net, vat, gross) = (
    select t.net, t.vat, t.gross from crm.document_totals(
      (select coalesce(jsonb_agg(to_jsonb(i)), '[]'::jsonb) from crm.invoice_items i where i.invoice_id = v_id),
      (select small_business from crm.settings where id = 1)) t)
   where v.id = v_id and v.status = 'draft';
  return null;
end $$;
drop trigger if exists invoice_items_totals on crm.invoice_items;
create trigger invoice_items_totals after insert or update or delete on crm.invoice_items
  for each row execute function crm.refresh_invoice_totals();

-- A finalised invoice keeps its content: only payment, dunning and cancellation fields may change.
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
    or new.due_date is distinct from old.due_date or new.intro is distinct from old.intro or new.outro is distinct from old.outro
    or new.net is distinct from old.net or new.vat is distinct from old.vat or new.gross is distinct from old.gross
    or new.seller_snapshot is distinct from old.seller_snapshot or new.customer_snapshot is distinct from old.customer_snapshot) then
    raise exception 'Rechnung % ist festgeschrieben und kann nicht mehr geändert werden.', old.number;
  end if;
  return new;
end $$;
drop trigger if exists invoices_guard on crm.invoices;
create trigger invoices_guard before update or delete on crm.invoices
  for each row execute function crm.guard_invoice();

create or replace function crm.guard_invoice_items() returns trigger
language plpgsql as $$
declare v_status text;
begin
  select status into v_status from crm.invoices where id = coalesce(new.invoice_id, old.invoice_id);
  if v_status is not null and v_status <> 'draft' then
    raise exception 'Positionen einer festgeschriebenen Rechnung sind unveränderlich.';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists invoice_items_guard on crm.invoice_items;
create trigger invoice_items_guard before insert or update or delete on crm.invoice_items
  for each row execute function crm.guard_invoice_items();

create or replace function crm.touch_updated_at() returns trigger
language plpgsql as $$ begin new.updated_at := now(); return new; end $$;
drop trigger if exists customers_touch on crm.customers;
create trigger customers_touch before update on crm.customers for each row execute function crm.touch_updated_at();
drop trigger if exists settings_touch on crm.settings;
create trigger settings_touch before update on crm.settings for each row execute function crm.touch_updated_at();


create or replace function crm.log(p_customer uuid, p_body text, p_kind text default 'system', p_actor text default 'System')
returns void language sql as $$
  insert into crm.activities (customer_id, kind, body, actor) values (p_customer, p_kind, p_body, p_actor);
$$;

-- Website form: the only entry point open without sign-in. Validates, merges the customer by
-- e-mail address and leaves a task for today.
create or replace function crm.submit_inquiry(
  p_name text, p_email text, p_phone text default '', p_company text default '',
  p_message text default '', p_source text default ''
) returns uuid
language plpgsql security definer set search_path = crm, public as $$
declare
  v_customer uuid;
  v_inquiry uuid;
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_name text := btrim(coalesce(nullif(btrim(p_company), ''), p_name, ''));
begin
  if length(v_name) < 2 or length(v_name) > 200 then raise exception 'Bitte einen Namen angeben.'; end if;
  if v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' or length(v_email) > 200 then raise exception 'Bitte eine gültige E-Mail-Adresse angeben.'; end if;
  if length(coalesce(p_message, '')) > 5000 or length(coalesce(p_phone, '')) > 60 then raise exception 'Eingabe zu lang.'; end if;
  if (select count(*) from crm.inquiries i join crm.customers c on c.id = i.customer_id
       where lower(c.email) = v_email and i.created_at > now() - interval '1 day') >= 5 then
    raise exception 'Zu viele Anfragen von dieser Adresse. Bitte morgen erneut versuchen.';
  end if;

  select id into v_customer from crm.customers where lower(email) = v_email;
  if v_customer is null then
    insert into crm.customers (kind, name, contact_person, email, phone, source)
    values (case when btrim(coalesce(p_company, '')) = '' then 'person' else 'company' end,
            v_name, case when btrim(coalesce(p_company, '')) = '' then '' else btrim(coalesce(p_name, '')) end,
            v_email, btrim(coalesce(p_phone, '')), 'website')
    returning id into v_customer;
  end if;

  insert into crm.inquiries (customer_id, channel, subject, message)
  values (v_customer, 'website', left(coalesce(nullif(btrim(p_source), ''), 'Kontaktformular'), 200), coalesce(p_message, ''))
  returning id into v_inquiry;
  perform crm.log(v_customer, 'Anfrage über das Kontaktformular eingegangen.');
  insert into crm.tasks (title, customer_id, origin) values ('Anfrage von ' || v_name || ' beantworten', v_customer, 'system');
  return v_inquiry;
end $$;

create or replace function crm.deal_from_inquiry(p_inquiry uuid, p_title text default '') returns crm.deals
language plpgsql as $$
declare v_inquiry crm.inquiries; v_deal crm.deals;
begin
  perform crm.require_writer();
  select * into v_inquiry from crm.inquiries where id = p_inquiry;
  if v_inquiry.id is null then raise exception 'Anfrage nicht gefunden.'; end if;
  insert into crm.deals (customer_id, inquiry_id, title, next_step, next_step_due)
  values (v_inquiry.customer_id, v_inquiry.id,
          coalesce(nullif(btrim(p_title), ''), nullif(v_inquiry.subject, ''), 'Neue Verkaufschance'),
          'Erstgespräch vereinbaren', current_date + 1)
  returning * into v_deal;
  update crm.inquiries set status = 'in_progress' where id = v_inquiry.id;
  update crm.tasks set done = true, done_at = now() where customer_id = v_inquiry.customer_id and origin = 'system' and not done and title like 'Anfrage von %';
  perform crm.log(v_inquiry.customer_id, 'Verkaufschance „' || v_deal.title || '“ angelegt.');
  return v_deal;
end $$;

create or replace function crm.create_quote(p_customer uuid, p_deal uuid default null) returns crm.quotes
language plpgsql as $$
declare v_quote crm.quotes; v_days int;
begin
  perform crm.require_writer();
  select quote_valid_days into v_days from crm.settings where id = 1;
  insert into crm.quotes (number, customer_id, deal_id, valid_until, intro, outro)
  values (crm.next_number('quote'), p_customer, p_deal, current_date + v_days,
          'vielen Dank für Ihre Anfrage. Gern biete ich Ihnen folgende Leistungen an:',
          'Ich freue mich auf Ihre Rückmeldung.')
  returning * into v_quote;
  if p_deal is not null then
    update crm.deals set stage = 'quote', next_step = 'Angebot nachfassen', next_step_due = current_date + 5 where id = p_deal and stage in ('new', 'meeting');
  end if;
  perform crm.log(p_customer, 'Angebot ' || v_quote.number || ' angelegt.');
  return v_quote;
end $$;

create or replace function crm.mark_quote_sent(p_quote uuid) returns crm.quotes
language plpgsql as $$
declare v_quote crm.quotes;
begin
  perform crm.require_writer();
  update crm.quotes set status = 'sent', sent_at = now(), issue_date = current_date
   where id = p_quote and status = 'draft' returning * into v_quote;
  if v_quote.id is null then raise exception 'Nur ein Entwurf kann versendet werden.'; end if;
  if not exists (select 1 from crm.quote_items where quote_id = p_quote) then raise exception 'Das Angebot hat noch keine Positionen.'; end if;
  perform crm.log(v_quote.customer_id, 'Angebot ' || v_quote.number || ' versendet.');
  return v_quote;
end $$;

create or replace function crm.accept_quote(p_quote uuid) returns crm.orders
language plpgsql as $$
declare v_quote crm.quotes; v_order crm.orders;
begin
  perform crm.require_writer();
  update crm.quotes set status = 'accepted', decided_at = now()
   where id = p_quote and status in ('draft', 'sent') returning * into v_quote;
  if v_quote.id is null then raise exception 'Dieses Angebot kann nicht mehr angenommen werden.'; end if;
  insert into crm.orders (number, customer_id, quote_id, title, due_date)
  values (crm.next_number('order'), v_quote.customer_id, v_quote.id,
          coalesce((select title from crm.deals where id = v_quote.deal_id), 'Auftrag aus ' || v_quote.number), current_date + 14)
  returning * into v_order;
  update crm.deals set stage = 'won', closed_at = now(), value_net = v_quote.net, next_step = '', next_step_due = null where id = v_quote.deal_id;
  insert into crm.tasks (title, customer_id, order_id, due_date, origin)
  values ('Auftrag ' || v_order.number || ' ausführen', v_quote.customer_id, v_order.id, v_order.due_date, 'system');
  perform crm.log(v_quote.customer_id, 'Angebot ' || v_quote.number || ' angenommen, Auftrag ' || v_order.number || ' angelegt.');
  return v_order;
end $$;

create or replace function crm.decline_quote(p_quote uuid) returns crm.quotes
language plpgsql as $$
declare v_quote crm.quotes;
begin
  perform crm.require_writer();
  update crm.quotes set status = 'declined', decided_at = now()
   where id = p_quote and status in ('draft', 'sent') returning * into v_quote;
  if v_quote.id is null then raise exception 'Dieses Angebot ist bereits entschieden.'; end if;
  update crm.deals set stage = 'lost', closed_at = now(), next_step = '', next_step_due = null where id = v_quote.deal_id;
  perform crm.log(v_quote.customer_id, 'Angebot ' || v_quote.number || ' abgelehnt.');
  return v_quote;
end $$;

create or replace function crm.invoice_from_order(p_order uuid) returns crm.invoices
language plpgsql as $$
declare v_order crm.orders; v_invoice crm.invoices;
begin
  perform crm.require_writer();
  select * into v_order from crm.orders where id = p_order;
  if v_order.id is null then raise exception 'Auftrag nicht gefunden.'; end if;
  select * into v_invoice from crm.invoices where order_id = p_order and status <> 'cancelled' and cancels_invoice_id is null limit 1;
  if v_invoice.id is not null then return v_invoice; end if;
  insert into crm.invoices (customer_id, order_id, intro, outro)
  values (v_order.customer_id, v_order.id, 'für die erbrachten Leistungen erlaube ich mir, folgende Rechnung zu stellen:',
          'Vielen Dank für Ihren Auftrag.')
  returning * into v_invoice;
  insert into crm.invoice_items (invoice_id, position, product_id, title, description, quantity, unit, unit_price_net, vat_rate)
  select v_invoice.id, position, product_id, title, description, quantity, unit, unit_price_net, vat_rate
    from crm.quote_items where quote_id = v_order.quote_id order by position;
  update crm.orders set status = 'done', done_at = coalesce(done_at, now()) where id = p_order and status in ('open', 'in_progress');
  update crm.tasks set done = true, done_at = now() where order_id = p_order and not done;
  perform crm.log(v_order.customer_id, 'Rechnungsentwurf zu Auftrag ' || v_order.number || ' angelegt.');
  select * into v_invoice from crm.invoices where id = v_invoice.id;
  return v_invoice;
end $$;

create or replace function crm.finalize_invoice(p_invoice uuid, p_service_date date default null) returns crm.invoices
language plpgsql as $$
declare v_invoice crm.invoices; v_days int; v_seller jsonb; v_customer jsonb;
begin
  perform crm.require_writer();
  select * into v_invoice from crm.invoices where id = p_invoice for update;
  if v_invoice.id is null or v_invoice.status <> 'draft' then raise exception 'Nur ein Entwurf kann festgeschrieben werden.'; end if;
  if not exists (select 1 from crm.invoice_items where invoice_id = p_invoice) then raise exception 'Die Rechnung hat noch keine Positionen.'; end if;
  select payment_days, to_jsonb(s) - 'updated_at' - 'id' into v_days, v_seller from crm.settings s where id = 1;
  if coalesce(v_seller ->> 'company_name', '') = '' or coalesce(v_seller ->> 'street', '') = '' or coalesce(v_seller ->> 'city', '') = '' then
    raise exception 'Bitte zuerst unter Einstellungen Firmenname und Anschrift eintragen.';
  end if;
  if coalesce(v_seller ->> 'tax_number', '') = '' and coalesce(v_seller ->> 'vat_id', '') = '' then
    raise exception 'Bitte zuerst unter Einstellungen Steuernummer oder Umsatzsteuer-Identifikationsnummer eintragen.';
  end if;
  select to_jsonb(c) - 'notes' - 'marketing_consent' - 'created_at' - 'updated_at' into v_customer from crm.customers c where id = v_invoice.customer_id;
  update crm.invoices set
    number = crm.next_number('invoice'),
    status = 'open',
    issue_date = current_date,
    service_date = coalesce(p_service_date, service_date, current_date),
    due_date = current_date + v_days,
    seller_snapshot = v_seller,
    customer_snapshot = v_customer,
    finalized_at = now()
  where id = p_invoice returning * into v_invoice;
  update crm.orders set status = 'invoiced' where id = v_invoice.order_id;
  perform crm.log(v_invoice.customer_id, 'Rechnung ' || v_invoice.number || ' über ' || crm.euro(v_invoice.gross) || ' festgeschrieben.');
  return v_invoice;
end $$;

create or replace function crm.record_payment(p_invoice uuid, p_amount numeric, p_paid_on date default current_date,
  p_method text default 'transfer', p_reference text default '') returns crm.invoices
language plpgsql as $$
declare v_invoice crm.invoices;
begin
  perform crm.require_writer();
  select * into v_invoice from crm.invoices where id = p_invoice for update;
  if v_invoice.id is null or v_invoice.status not in ('open', 'paid') then raise exception 'Zahlungen gibt es nur zu festgeschriebenen Rechnungen.'; end if;
  insert into crm.payments (invoice_id, amount, paid_on, method, reference) values (p_invoice, p_amount, p_paid_on, p_method, coalesce(p_reference, ''));
  update crm.invoices set
    paid_amount = (select coalesce(sum(amount), 0) from crm.payments where invoice_id = p_invoice),
    status = case when (select coalesce(sum(amount), 0) from crm.payments where invoice_id = p_invoice) >= gross then 'paid' else 'open' end,
    paid_at = case when (select coalesce(sum(amount), 0) from crm.payments where invoice_id = p_invoice) >= gross then now() else null end
  where id = p_invoice returning * into v_invoice;
  update crm.tasks set done = true, done_at = now() where invoice_id = p_invoice and not done and v_invoice.status = 'paid';
  update crm.approvals set status = 'rejected', decided_at = now() where invoice_id = p_invoice and status = 'pending' and v_invoice.status = 'paid';
  perform crm.log(v_invoice.customer_id, 'Zahlung über ' || crm.euro(p_amount) || ' zu Rechnung ' || v_invoice.number || ' erfasst.');
  return v_invoice;
end $$;

create or replace function crm.cancel_invoice(p_invoice uuid) returns crm.invoices
language plpgsql as $$
declare v_original crm.invoices; v_credit crm.invoices;
begin
  perform crm.require_writer();
  select * into v_original from crm.invoices where id = p_invoice for update;
  if v_original.id is null or v_original.status <> 'open' or v_original.paid_amount > 0 then
    raise exception 'Stornieren geht nur bei festgeschriebenen, noch nicht bezahlten Rechnungen.';
  end if;
  if v_original.cancels_invoice_id is not null then raise exception 'Eine Stornorechnung kann nicht storniert werden.'; end if;
  insert into crm.invoices (customer_id, order_id, cancels_invoice_id, intro, outro)
  values (v_original.customer_id, v_original.order_id, v_original.id,
          'hiermit storniere ich die Rechnung ' || v_original.number || ' vom ' || to_char(v_original.issue_date, 'DD.MM.YYYY') || '.', '')
  returning * into v_credit;
  insert into crm.invoice_items (invoice_id, position, product_id, title, description, quantity, unit, unit_price_net, vat_rate)
  select v_credit.id, position, product_id, title, description, -quantity, unit, unit_price_net, vat_rate
    from crm.invoice_items where invoice_id = v_original.id order by position;
  perform crm.finalize_invoice(v_credit.id, v_original.service_date);
  update crm.invoices set status = 'paid', paid_at = now() where id = v_credit.id;
  update crm.invoices set status = 'cancelled' where id = v_original.id;
  update crm.orders set status = 'done' where id = v_original.order_id and status = 'invoiced';
  update crm.approvals set status = 'rejected', decided_at = now() where invoice_id = v_original.id and status = 'pending';
  perform crm.log(v_original.customer_id, 'Rechnung ' || v_original.number || ' storniert.');
  select * into v_credit from crm.invoices where id = v_credit.id;
  return v_credit;
end $$;

-- Overdue invoices step up one dunning level at a time, at most every 7 days. The reminder is not
-- sent by the database; it lands in the approval centre for Daniel.
create or replace function crm.run_dunning() returns int
language plpgsql as $$
declare v_invoice crm.invoices; v_count int := 0; v_level int;
begin
  perform crm.require_writer();
  for v_invoice in
    select * from crm.invoices
     where status = 'open' and cancels_invoice_id is null and due_date < current_date and dunning_level < 3
       and (last_dunning_at is null or last_dunning_at <= current_date - 7)
       and not exists (select 1 from crm.approvals a where a.invoice_id = invoices.id and a.kind = 'dunning' and a.status = 'pending')
  loop
    v_level := v_invoice.dunning_level + 1;
    insert into crm.approvals (kind, title, body, customer_id, invoice_id, payload)
    values ('dunning',
            case v_level when 1 then 'Zahlungserinnerung' when 2 then '1. Mahnung' else '2. Mahnung' end || ' zu Rechnung ' || v_invoice.number,
            'Offen: ' || crm.euro(v_invoice.gross - v_invoice.paid_amount) || ', fällig seit ' || to_char(v_invoice.due_date, 'DD.MM.YYYY') || '.',
            v_invoice.customer_id, v_invoice.id, jsonb_build_object('level', v_level));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function crm.decide_approval(p_approval uuid, p_approve boolean) returns crm.approvals
language plpgsql as $$
declare v_approval crm.approvals; v_level int;
begin
  perform crm.require_writer();
  update crm.approvals set status = case when p_approve then 'approved' else 'rejected' end, decided_at = now()
   where id = p_approval and status = 'pending' returning * into v_approval;
  if v_approval.id is null then raise exception 'Diese Freigabe ist bereits entschieden.'; end if;
  if p_approve and v_approval.kind = 'dunning' and v_approval.invoice_id is not null then
    v_level := coalesce((v_approval.payload ->> 'level')::int, 1);
    update crm.invoices set dunning_level = greatest(dunning_level, v_level), last_dunning_at = current_date where id = v_approval.invoice_id;
  end if;
  perform crm.log(v_approval.customer_id, 'Freigabe „' || v_approval.title || '“ ' || case when p_approve then 'erteilt' else 'abgelehnt' end || '.');
  return v_approval;
end $$;

create or replace function crm.create_ticket(p_customer uuid, p_subject text, p_body text default '', p_priority text default 'normal')
returns crm.tickets
language plpgsql as $$
declare v_ticket crm.tickets;
begin
  perform crm.require_writer();
  insert into crm.tickets (number, customer_id, subject, body, priority)
  values (crm.next_number('ticket'), p_customer, p_subject, coalesce(p_body, ''), p_priority)
  returning * into v_ticket;
  insert into crm.tasks (title, customer_id, ticket_id, origin) values ('Ticket ' || v_ticket.number || ' bearbeiten', p_customer, v_ticket.id, 'system');
  if p_customer is not null then perform crm.log(p_customer, 'Ticket ' || v_ticket.number || ': ' || p_subject); end if;
  return v_ticket;
end $$;

-- Monthly subscriptions become invoice drafts on their due day; Daniel finalises them.
create or replace function crm.bill_subscriptions() returns int
language plpgsql as $$
declare v_sub record; v_invoice uuid; v_count int := 0;
begin
  perform crm.require_writer();
  for v_sub in
    select s.*, p.name, p.description, p.unit, p.price_net, p.vat_rate
      from crm.subscriptions s join crm.products p on p.id = s.product_id
     where s.active and s.next_invoice_date <= current_date
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
    'pipeline_value', (select coalesce(sum(value_net), 0) from crm.deals where stage not in ('won', 'lost'))
  )
$$;

-- Rights: only the administrator signs in and writes; agents use the service key, which bypasses
-- row level security; the website form reaches only submit_inquiry.
do $$
declare t text;
begin
  foreach t in array array['settings', 'number_ranges', 'customers', 'inquiries', 'deals', 'products', 'quotes', 'quote_items',
                           'orders', 'invoices', 'invoice_items', 'payments', 'tickets', 'tasks', 'activities', 'subscriptions', 'approvals'] loop
    execute format('alter table crm.%I enable row level security', t);
    execute format('drop policy if exists admin_all on crm.%I', t);
    execute format('create policy admin_all on crm.%I for all to authenticated using (public.is_admin()) with check (public.is_admin())', t);
  end loop;
end $$;

grant usage on schema crm to anon, authenticated, service_role;
grant select, insert, update, delete on all tables in schema crm to authenticated, service_role;
revoke all on all functions in schema crm from public, anon;
grant execute on all functions in schema crm to authenticated, service_role;
grant execute on function crm.submit_inquiry(text, text, text, text, text, text) to anon;

-- The REST interface serves only listed schemas; keep the existing list and add crm.
do $$
declare v_current text;
begin
  select substr(c, length('pgrst.db_schemas=') + 1) into v_current
    from pg_roles r, unnest(r.rolconfig) c
   where r.rolname = 'authenticator' and c like 'pgrst.db_schemas=%';
  v_current := coalesce(v_current, 'public, graphql_public');
  if v_current !~ '(^|,\s*)crm(\s*,|$)' then
    execute format('alter role authenticator set pgrst.db_schemas = %L', v_current || ', crm');
  end if;
end $$;
notify pgrst, 'reload config';
notify pgrst, 'reload schema';
