-- RepoCity CRM, fixes found by walking every business scenario end to end.
-- Context: builds on 004_flow.sql and cockpit 002; the scenarios are listed in integration/README.md.
-- | Input: none. | Output: crm.run_review_requests, which no longer leaves requests waiting for the
-- review link once the link is set. Re-runnable: every statement replaces or checks first.

-- A request of a customer without an e-mail address used to stay waiting_link after the link was set,
-- so the Cockpit kept reporting the link as missing every day. With the link set, every waiting request
-- is due again and goes out as soon as the customer has an address.
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
  update crm.review_requests set status = 'due' where status = 'waiting_link';
  for v_request in
    select r.* from crm.review_requests r join crm.customers c on c.id = r.customer_id
     where nullif(btrim(c.email), '') is not null
       and (r.status = 'due' or (r.status = 'sent' and r.reminder_due <= current_date))
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

notify pgrst, 'reload schema';
