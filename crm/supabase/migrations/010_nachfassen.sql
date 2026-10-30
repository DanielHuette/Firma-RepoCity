-- RepoCity CRM, follow-up mails on sent quotes and opting out of them.
-- Context: builds on 001-009; decided with Daniel on 30.10.2026 (Nova point 3): a quote without an
-- answer gets a reminder after 5 and after 12 days, each only after "Senden" in the Cockpit or on the
-- lock screen; none is proposed when the customer has written, called or asked since the quote, when
-- the quote ran out or when the customer opted out. Every reminder carries a link "Keine Erinnerungen
-- mehr" and the header with which mail programs show their own unsubscribe button (RFC 8058, one
-- click by POST). Opting out also stops review requests. Quotes past their date are now set to expired.
-- The decision branch for mails drafted by the assistant (migration 012) is here too, so
-- crm.decide_approval is defined once. | Input: sent quotes, Daniel's decisions, the customer's click.
-- | Output: crm.expire_quotes, crm.run_follow_ups (both in crm.daily_routine), crm.send_follow_up,
-- crm.opt_out, mail texts follow_up_1 and follow_up_2, approvals of kind follow_up. Re-runnable.

-- Tables

alter table crm.customers add column if not exists no_follow_ups boolean not null default false;
-- The secret part of the opt-out link of this customer.
alter table crm.customers add column if not exists optout_token uuid not null default gen_random_uuid();
create unique index if not exists customers_optout_token on crm.customers (optout_token);

-- How many reminders of this quote are done: sent, or skipped with "Nicht senden".
alter table crm.quotes add column if not exists follow_up_level int not null default 0;
-- When the last reminder was sent or declined; the next comes a week later at the earliest.
alter table crm.quotes add column if not exists follow_up_at timestamptz;
alter table crm.quotes drop constraint if exists quotes_follow_up_level_check;
alter table crm.quotes add constraint quotes_follow_up_level_check check (follow_up_level between 0 and 2);

-- The opt-out address the mail worker puts into the List-Unsubscribe header.
alter table crm.outbox add column if not exists list_unsubscribe text not null default '';

-- The kinds follow_up and assistant_mail are allowed by migration 009.
insert into crm.mail_texts (key, subject, body) values
('follow_up_1', 'Kurze Nachfrage zu meinem Angebot {{nummer}}', '{{anrede}}

vor einigen Tagen habe ich Ihnen mein Angebot {{nummer}} über {{betrag}} geschickt. Haben Sie noch Fragen dazu? Eine kurze Antwort auf diese E-Mail genügt, gern rufe ich Sie auch an. Das Angebot gilt bis zum {{faellig}}.

Wenn Sie keine Erinnerungen mehr erhalten möchten, genügt ein Klick: {{abmeldelink}}

Mit freundlichen Grüßen
{{inhaber}}'),
('follow_up_2', 'Ihr Angebot {{nummer}} gilt bis zum {{faellig}}', '{{anrede}}

ich wollte mich noch einmal zu meinem Angebot {{nummer}} über {{betrag}} melden. Es gilt bis zum {{faellig}}. Wenn es für Sie gerade nicht passt, ist das völlig in Ordnung; dann melde ich mich nicht weiter dazu.

Wenn Sie keine Erinnerungen mehr erhalten möchten, genügt ein Klick: {{abmeldelink}}

Mit freundlichen Grüßen
{{inhaber}}')
on conflict (key) do nothing;

-- Helpers

-- The public address of the project's server functions (Supabase Edge Functions).
create or replace function crm.functions_url() returns text
language sql immutable as $$ select 'https://yizvntdwdajlgcbjcves.supabase.co/functions/v1' $$;

create or replace function crm.optout_link(p_customer uuid) returns text
language sql stable as $$
  select crm.functions_url() || '/crm-abmelden?t=' || optout_token from crm.customers where id = p_customer
$$;

-- A mail from the customer, a call or a new inquiry since the given moment.
create or replace function crm.customer_in_touch_since(p_customer uuid, p_since timestamptz) returns boolean
language sql stable as $$
  select exists (select 1 from crm.emails where customer_id = p_customer and direction = 'in' and sent_at > p_since)
      or exists (select 1 from crm.calls where customer_id = p_customer and started_at > p_since)
      or exists (select 1 from crm.inquiries where customer_id = p_customer and created_at > p_since)
$$;

-- Days after sending at which reminder 1 and 2 are due.
create or replace function crm.follow_up_days(p_level int) returns int
language sql immutable as $$ select case p_level when 1 then 5 when 2 then 12 end $$;

-- Quotes

create or replace function crm.expire_quotes() returns int
language plpgsql as $$
declare v_count int;
begin
  perform crm.require_writer();
  update crm.quotes set status = 'expired' where status = 'sent' and valid_until < current_date;
  get diagnostics v_count = row_count;
  return v_count;
end $$;

-- Daily: one approval per due reminder; "Senden" queues the mail through crm.send_follow_up.
create or replace function crm.run_follow_ups() returns int
language plpgsql as $$
declare v_quote record; v_level int; v_count int := 0;
begin
  perform crm.require_writer();
  for v_quote in
    select q.*, c.name as customer_name from crm.quotes q join crm.customers c on c.id = q.customer_id
     where q.status = 'sent' and q.valid_until >= current_date and q.follow_up_level < 2 and q.sent_at is not null
       and not c.no_follow_ups and nullif(btrim(c.email), '') is not null
       and q.sent_at <= now() - make_interval(days => crm.follow_up_days(q.follow_up_level + 1))
       and (q.follow_up_at is null or q.follow_up_at <= now() - interval '7 days')
       and not exists (select 1 from crm.approvals a where a.kind = 'follow_up' and a.status = 'pending'
                        and a.payload ->> 'quote_id' = q.id::text)
       and not crm.customer_in_touch_since(q.customer_id, q.sent_at)
  loop
    v_level := v_quote.follow_up_level + 1;
    insert into crm.approvals (kind, title, body, customer_id, payload)
    values ('follow_up',
            case v_level when 1 then 'Nachfass-Mail' else '2. Nachfass-Mail' end || ' zu Angebot ' || v_quote.number || ' senden?',
            v_quote.customer_name || ' hat auf das Angebot über ' || crm.euro(v_quote.gross) || ' vom ' || crm.date_de(v_quote.sent_at::date)
              || ' noch nicht geantwortet. Es gilt bis zum ' || crm.date_de(v_quote.valid_until) || '.',
            v_quote.customer_id, jsonb_build_object('quote_id', v_quote.id, 'level', v_level));
    v_count := v_count + 1;
  end loop;
  return v_count;
end $$;

create or replace function crm.send_follow_up(p_quote uuid, p_level int, p_approval uuid) returns crm.outbox
language plpgsql as $$
declare v_quote crm.quotes; v_link text; v_mail crm.outbox;
begin
  select * into v_quote from crm.quotes where id = p_quote for update;
  if v_quote.id is null or v_quote.status <> 'sent' then raise exception 'Das Angebot ist schon entschieden.'; end if;
  if v_quote.valid_until < current_date then raise exception 'Das Angebot ist abgelaufen.'; end if;
  if (select no_follow_ups from crm.customers where id = v_quote.customer_id) then
    raise exception 'Der Kunde möchte keine Erinnerungen mehr.';
  end if;
  if crm.customer_in_touch_since(v_quote.customer_id, v_quote.sent_at) then
    raise exception 'Der Kunde hat sich seit dem Angebot gemeldet; die Erinnerung entfällt.';
  end if;
  v_link := crm.optout_link(v_quote.customer_id);
  v_mail := crm.queue_mail('follow_up', v_quote.customer_id, 'follow_up_' || p_level,
    crm.mail_values(v_quote.customer_id, v_quote.number, v_quote.gross, v_quote.valid_until) || jsonb_build_object('abmeldelink', v_link),
    p_quote => v_quote.id, p_approval => p_approval);
  update crm.outbox set list_unsubscribe = v_link where id = v_mail.id returning * into v_mail;
  update crm.quotes set follow_up_level = greatest(follow_up_level, p_level), follow_up_at = now() where id = p_quote;
  perform crm.log(v_quote.customer_id, case p_level when 1 then 'Nachfass-Mail' else '2. Nachfass-Mail' end
    || ' zu Angebot ' || v_quote.number || ' freigegeben.');
  return v_mail;
end $$;

-- A quote that is no longer open drops its waiting reminder.
create or replace function crm.drop_follow_up_question() returns trigger
language plpgsql as $$
begin
  if old.status = 'sent' and new.status <> 'sent' then
    update crm.approvals set status = 'rejected', decided_at = now()
     where kind = 'follow_up' and status = 'pending' and payload ->> 'quote_id' = new.id::text;
  end if;
  return new;
end $$;
create or replace trigger drop_follow_up_question after update of status on crm.quotes for each row execute function crm.drop_follow_up_question();

-- A mail, call or inquiry of the customer withdraws a waiting reminder: the customer has answered.
create or replace function crm.withdraw_follow_ups() returns trigger
language plpgsql as $$
begin
  if new.customer_id is null or (tg_table_name = 'emails' and to_jsonb(new) ->> 'direction' <> 'in') then
    return new;
  end if;
  update crm.approvals set status = 'rejected', decided_at = now()
   where kind = 'follow_up' and status = 'pending' and customer_id = new.customer_id;
  return new;
end $$;
create or replace trigger withdraw_follow_ups after insert or update of customer_id on crm.emails for each row execute function crm.withdraw_follow_ups();
create or replace trigger withdraw_follow_ups after insert or update of customer_id on crm.calls for each row execute function crm.withdraw_follow_ups();
create or replace trigger withdraw_follow_ups after insert or update of customer_id on crm.inquiries for each row execute function crm.withdraw_follow_ups();

-- The customer's click on the opt-out page: no more reminders and no more review requests, also
-- none of those already waiting to be sent (Article 21 of the General Data Protection Regulation).
create or replace function crm.opt_out(p_token uuid) returns boolean
language plpgsql as $$
declare v_customer uuid;
begin
  perform crm.require_writer();
  update crm.customers set no_follow_ups = true, no_review_requests = true where optout_token = p_token returning id into v_customer;
  if v_customer is null then return false; end if;
  update crm.approvals set status = 'rejected', decided_at = now()
   where kind = 'follow_up' and status = 'pending' and customer_id = v_customer;
  delete from crm.outbox where customer_id = v_customer and status = 'queued'
     and kind in ('follow_up', 'review_request', 'review_reminder');
  perform crm.log(v_customer, 'Hat über den Link in der E-Mail Erinnerungen und Bewertungsanfragen abbestellt.', 'system', 'Kunde');
  return true;
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
  elsif v_approval.kind = 'follow_up' and v_approval.payload ? 'quote_id' then
    if p_approve then
      perform crm.send_follow_up((v_approval.payload ->> 'quote_id')::uuid, (v_approval.payload ->> 'level')::int, v_approval.id);
    else
      -- "Nicht senden" counts this reminder as done, so it does not come back tomorrow.
      update crm.quotes set follow_up_level = greatest(follow_up_level, (v_approval.payload ->> 'level')::int),
             follow_up_at = now()
       where id = (v_approval.payload ->> 'quote_id')::uuid;
    end if;
  elsif v_approval.kind = 'assistant_mail' and v_approval.payload ? 'customer_id' then
    if p_approve then perform crm.send_assistant_mail(v_approval); end if;
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

create or replace function crm.daily_routine() returns void
language plpgsql as $$
begin
  perform crm.require_writer();
  begin perform crm.run_dunning(); exception when others then perform crm.routine_failed('Mahnwesen', sqlerrm); end;
  begin perform crm.bill_subscriptions(); exception when others then perform crm.routine_failed('Abo-Rechnungen', sqlerrm); end;
  begin perform crm.flag_due_audits(); exception when others then perform crm.routine_failed('Monatsprüfungen', sqlerrm); end;
  begin perform crm.run_review_requests(); exception when others then perform crm.routine_failed('Bewertungsanfragen', sqlerrm); end;
  begin perform crm.expire_quotes(); exception when others then perform crm.routine_failed('Abgelaufene Angebote', sqlerrm); end;
  begin perform crm.run_follow_ups(); exception when others then perform crm.routine_failed('Nachfass-Mails', sqlerrm); end;
end $$;

-- Rights

revoke all on function crm.functions_url(), crm.optout_link(uuid), crm.customer_in_touch_since(uuid, timestamptz),
  crm.follow_up_days(int), crm.expire_quotes(), crm.run_follow_ups(), crm.send_follow_up(uuid, int, uuid),
  crm.drop_follow_up_question(), crm.withdraw_follow_ups(), crm.opt_out(uuid)
  from public, anon, authenticated;
grant execute on function crm.functions_url(), crm.optout_link(uuid), crm.customer_in_touch_since(uuid, timestamptz),
  crm.follow_up_days(int), crm.send_follow_up(uuid, int, uuid), crm.drop_follow_up_question()
  to authenticated, service_role;
grant execute on function crm.expire_quotes(), crm.run_follow_ups(), crm.opt_out(uuid) to service_role;

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
