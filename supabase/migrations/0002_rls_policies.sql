-- Data Layer 0002: day-1 privilege boundary.
-- Source of truth: research sections 6.3.1, 6.3.2, 6.3.3 and ADR-019.

create schema if not exists api;
create schema if not exists private;
create schema if not exists maintenance;

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dentino_confirm_api') then
    create role dentino_confirm_api login noinherit nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'dentino_confirm_definer') then
    create role dentino_confirm_definer noinherit nologin nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'dentino_run_api') then
    create role dentino_run_api login noinherit nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'dentino_maintenance_runner') then
    create role dentino_maintenance_runner login noinherit nobypassrls;
  end if;

  if not exists (select 1 from pg_roles where rolname = 'dentino_maintenance_definer') then
    create role dentino_maintenance_definer noinherit nologin nobypassrls;
  end if;
end;
$$;

do $$
begin
  execute format('grant dentino_confirm_definer to %I', current_user);
  execute format('grant dentino_maintenance_definer to %I', current_user);
end;
$$;

alter role dentino_confirm_api set statement_timeout = '2000ms';
alter role dentino_confirm_api set lock_timeout = '250ms';
alter role dentino_confirm_api set idle_in_transaction_session_timeout = '2000ms';

revoke all on schema app, api, private, maintenance from public;
revoke all on schema app, private, maintenance from anon, authenticated;
grant usage on schema api to dentino_confirm_api;
grant usage on schema app, private, vault, extensions to dentino_confirm_definer;
grant create on schema api, private to dentino_confirm_definer;
grant usage on schema app, extensions to dentino_run_api;
grant usage on schema app, maintenance, extensions to dentino_maintenance_definer;
grant create on schema maintenance to dentino_maintenance_definer;
grant usage on schema maintenance to dentino_maintenance_runner;

do $$
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    grant select on vault.decrypted_secrets to dentino_confirm_definer;
  end if;
end;
$$;

revoke all on all tables in schema app from public, anon, authenticated, dentino_confirm_api;
revoke all on all sequences in schema app from public, anon, authenticated, dentino_confirm_api;
alter default privileges in schema app revoke all on tables from public, anon, authenticated;
alter default privileges in schema app revoke all on sequences from public, anon, authenticated;
alter default privileges in schema api revoke execute on functions from public;
alter default privileges in schema private revoke execute on functions from public;
alter default privileges in schema maintenance revoke execute on functions from public;

grant select, insert, update on app.patients to dentino_run_api;
grant insert, update, select on app.reminder_runs to dentino_run_api;
grant insert, update, select on app.reminder_days to dentino_run_api;
grant select, insert, update, delete on app.reminder_messages to dentino_run_api;
grant insert, select on app.crm_visit_facts to dentino_run_api;
grant select on app.message_templates to dentino_run_api;
grant select on app.cliniccards_status_policy to dentino_run_api;
grant insert on app.consent_events to dentino_run_api;
grant select, insert, update on app.cancellation_circuits to dentino_run_api;
grant select, insert, update, delete on app.crm_visit_write_locks to dentino_run_api;
grant insert, select on app.inbound_events to dentino_run_api;
grant insert, select on app.crm_fetch_log to dentino_run_api;
grant insert on app.audit_log to dentino_run_api;
grant usage, select on all sequences in schema app to dentino_run_api;

grant select, update on app.patients to dentino_confirm_definer;
grant select, update on app.reminder_messages to dentino_confirm_definer;
grant select, insert, update, delete on app.crm_visit_write_locks to dentino_confirm_definer;
grant select, insert, update on app.cancellation_circuits to dentino_confirm_definer;
grant insert, select on app.consent_events to dentino_confirm_definer;
grant insert on app.audit_log to dentino_confirm_definer;
grant usage, select on all sequences in schema app to dentino_confirm_definer;

grant update, select on app.reminder_messages to dentino_maintenance_definer;
grant update, select on app.patients to dentino_maintenance_definer;
grant update, select on app.consent_events to dentino_maintenance_definer;
grant delete, select on app.inbound_events to dentino_maintenance_definer;
grant delete, select on app.crm_fetch_log to dentino_maintenance_definer;
grant delete, select on app.crm_visit_facts to dentino_maintenance_definer;
grant insert on app.audit_log to dentino_maintenance_definer;
grant usage, select on all sequences in schema app to dentino_maintenance_definer;

do $$
declare
  app_table record;
begin
  for app_table in
    select tablename
    from pg_tables
    where schemaname = 'app'
    order by tablename
  loop
    execute format('alter table app.%I enable row level security', app_table.tablename);
    execute format('alter table app.%I force row level security', app_table.tablename);
  end loop;
end;
$$;

drop policy if exists patients_run_api_all on app.patients;
create policy patients_run_api_all on app.patients
  for all to dentino_run_api using (true) with check (true);
drop policy if exists reminder_runs_run_api_all on app.reminder_runs;
create policy reminder_runs_run_api_all on app.reminder_runs
  for all to dentino_run_api using (true) with check (true);
drop policy if exists reminder_days_run_api_all on app.reminder_days;
create policy reminder_days_run_api_all on app.reminder_days
  for all to dentino_run_api using (true) with check (true);
drop policy if exists reminder_messages_run_api_all on app.reminder_messages;
create policy reminder_messages_run_api_all on app.reminder_messages
  for all to dentino_run_api using (true) with check (true);
drop policy if exists crm_visit_facts_run_api_all on app.crm_visit_facts;
create policy crm_visit_facts_run_api_all on app.crm_visit_facts
  for all to dentino_run_api using (true) with check (true);
drop policy if exists message_templates_run_api_select on app.message_templates;
create policy message_templates_run_api_select on app.message_templates
  for select to dentino_run_api using (true);
drop policy if exists cliniccards_status_policy_run_api_select on app.cliniccards_status_policy;
create policy cliniccards_status_policy_run_api_select on app.cliniccards_status_policy
  for select to dentino_run_api using (true);
drop policy if exists consent_events_run_api_insert on app.consent_events;
create policy consent_events_run_api_insert on app.consent_events
  for insert to dentino_run_api with check (true);
drop policy if exists cancellation_circuits_run_api_all on app.cancellation_circuits;
create policy cancellation_circuits_run_api_all on app.cancellation_circuits
  for all to dentino_run_api using (true) with check (true);
drop policy if exists crm_visit_write_locks_run_api_all on app.crm_visit_write_locks;
create policy crm_visit_write_locks_run_api_all on app.crm_visit_write_locks
  for all to dentino_run_api using (true) with check (true);
drop policy if exists inbound_events_run_api_all on app.inbound_events;
create policy inbound_events_run_api_all on app.inbound_events
  for all to dentino_run_api using (true) with check (true);
drop policy if exists crm_fetch_log_run_api_all on app.crm_fetch_log;
create policy crm_fetch_log_run_api_all on app.crm_fetch_log
  for all to dentino_run_api using (true) with check (true);
drop policy if exists audit_log_run_api_insert on app.audit_log;
create policy audit_log_run_api_insert on app.audit_log
  for insert to dentino_run_api with check (true);

drop policy if exists patients_confirm_definer_all on app.patients;
create policy patients_confirm_definer_all on app.patients
  for all to dentino_confirm_definer using (true) with check (true);
drop policy if exists reminder_messages_confirm_definer_all on app.reminder_messages;
create policy reminder_messages_confirm_definer_all on app.reminder_messages
  for all to dentino_confirm_definer using (true) with check (true);
drop policy if exists crm_visit_write_locks_confirm_definer_all on app.crm_visit_write_locks;
create policy crm_visit_write_locks_confirm_definer_all on app.crm_visit_write_locks
  for all to dentino_confirm_definer using (true) with check (true);
drop policy if exists cancellation_circuits_confirm_definer_all on app.cancellation_circuits;
create policy cancellation_circuits_confirm_definer_all on app.cancellation_circuits
  for all to dentino_confirm_definer using (true) with check (true);
drop policy if exists consent_events_confirm_definer_insert on app.consent_events;
create policy consent_events_confirm_definer_insert on app.consent_events
  for insert to dentino_confirm_definer with check (true);
drop policy if exists consent_events_confirm_definer_select on app.consent_events;
create policy consent_events_confirm_definer_select on app.consent_events
  for select to dentino_confirm_definer using (true);
drop policy if exists audit_log_confirm_definer_insert on app.audit_log;
create policy audit_log_confirm_definer_insert on app.audit_log
  for insert to dentino_confirm_definer with check (true);

drop policy if exists reminder_messages_maintenance_definer_all on app.reminder_messages;
create policy reminder_messages_maintenance_definer_all on app.reminder_messages
  for all to dentino_maintenance_definer using (true) with check (true);
drop policy if exists patients_maintenance_definer_all on app.patients;
create policy patients_maintenance_definer_all on app.patients
  for all to dentino_maintenance_definer using (true) with check (true);
drop policy if exists consent_events_maintenance_definer_all on app.consent_events;
create policy consent_events_maintenance_definer_all on app.consent_events
  for all to dentino_maintenance_definer using (true) with check (true);
drop policy if exists inbound_events_maintenance_definer_all on app.inbound_events;
create policy inbound_events_maintenance_definer_all on app.inbound_events
  for all to dentino_maintenance_definer using (true) with check (true);
drop policy if exists crm_fetch_log_maintenance_definer_all on app.crm_fetch_log;
create policy crm_fetch_log_maintenance_definer_all on app.crm_fetch_log
  for all to dentino_maintenance_definer using (true) with check (true);
drop policy if exists crm_visit_facts_maintenance_definer_all on app.crm_visit_facts;
create policy crm_visit_facts_maintenance_definer_all on app.crm_visit_facts
  for all to dentino_maintenance_definer using (true) with check (true);
drop policy if exists audit_log_maintenance_definer_insert on app.audit_log;
create policy audit_log_maintenance_definer_insert on app.audit_log
  for insert to dentino_maintenance_definer with check (true);

create or replace function private.token_digest(p_raw_token text)
returns bytea
language plpgsql
security definer
set search_path = ''
as $$
declare
  token_pepper text;
begin
  if p_raw_token is null then
    return null;
  end if;

  begin
    select decrypted_secret
      into token_pepper
      from vault.decrypted_secrets
     where name = 'TOKEN_PEPPER_V1'
     limit 1;
  exception
    when insufficient_privilege or undefined_function or undefined_table then
      if nullif(current_setting('app.env', true), '') not in ('test', 'ci', 'dev') then
        raise;
      end if;
      token_pepper := null;
  end;

  if token_pepper is null then
    if nullif(current_setting('app.env', true), '') in ('test', 'ci', 'dev') then
      token_pepper := 'test-only-token-pepper';
    else
      raise exception 'TOKEN_PEPPER_V1 is not configured' using errcode = '22023';
    end if;
  end if;

  return extensions.hmac(
    convert_to(p_raw_token, 'utf8'),
    convert_to(token_pepper, 'utf8'),
    'sha256'
  );
end;
$$;

alter function private.token_digest(text) owner to dentino_confirm_definer;
revoke all on function private.token_digest(text) from public, anon, authenticated, dentino_confirm_api;

create or replace function api.lookup_reminder_by_token(p_raw_token text)
returns table (
  ok boolean,
  neutral_reason text,
  target_at timestamptz,
  display_snapshot text,
  already_responded boolean,
  response text,
  clinic_phone text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reminder app.reminder_messages%rowtype;
  configured_clinic_phone text := nullif(current_setting('app.clinic_phone', true), '');
begin
  if p_raw_token is null or p_raw_token !~ '^[A-Za-z0-9_-]{20,128}$' then
    return query select false, 'invalid_or_expired', null::timestamptz, null::text, false, null::text, configured_clinic_phone;
    return;
  end if;

  select *
    into reminder
    from app.reminder_messages
   where tracking_token_digest = private.token_digest(p_raw_token)
     and token_expires_at > app.now()
     and superseded_at is null
     and status in ('sent', 'delivered', 'send_unknown')
   limit 1;

  if not found then
    return query select false, 'invalid_or_expired', null::timestamptz, null::text, false, null::text, configured_clinic_phone;
    return;
  end if;

  return query select
    true,
    null::text,
    reminder.target_at,
    reminder.patient_display_snapshot,
    reminder.response is not null,
    reminder.response,
    configured_clinic_phone;
end;
$$;

create or replace function api.prepare_reminder_action(
  p_raw_token text,
  p_action text
)
returns table (
  ok boolean,
  neutral_reason text,
  action_nonce text,
  nonce_expires_at timestamptz,
  target_at timestamptz,
  display_snapshot text,
  clinic_phone text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  generated_nonce text;
  generated_nonce_expires_at timestamptz := app.now() + interval '10 minutes';
  updated_message app.reminder_messages%rowtype;
  configured_clinic_phone text := nullif(current_setting('app.clinic_phone', true), '');
begin
  if p_raw_token is null
     or p_raw_token !~ '^[A-Za-z0-9_-]{20,128}$'
     or p_action not in ('confirm', 'cancel') then
    return query select false, 'invalid_or_expired', null::text, null::timestamptz, null::timestamptz, null::text, configured_clinic_phone;
    return;
  end if;

  generated_nonce := regexp_replace(
    translate(encode(extensions.gen_random_bytes(24), 'base64'), '+/', '-_'),
    '=+$',
    ''
  );

  update app.reminder_messages
     set action_nonce_digest = private.token_digest(generated_nonce),
         action_nonce_expires_at = generated_nonce_expires_at
   where tracking_token_digest = private.token_digest(p_raw_token)
     and token_expires_at > app.now()
     and superseded_at is null
     and status in ('sent', 'delivered', 'send_unknown')
     and action_locked_at is null
     and response is null
   returning *
    into updated_message;

  if not found then
    return query select false, 'invalid_or_expired', null::text, null::timestamptz, null::timestamptz, null::text, configured_clinic_phone;
    return;
  end if;

  return query select
    true,
    null::text,
    generated_nonce,
    generated_nonce_expires_at,
    updated_message.target_at,
    updated_message.patient_display_snapshot,
    configured_clinic_phone;
end;
$$;

create or replace function api.record_reminder_action(
  p_raw_token text,
  p_action text,
  p_nonce text
)
returns table (
  ok boolean,
  neutral_reason text,
  message_id bigint,
  cliniccards_visit_id text,
  crm_target_status text,
  lock_token uuid,
  action_taken text,
  target_at timestamptz,
  display_snapshot text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  reminder app.reminder_messages%rowtype;
  consent_event_id bigint;
  desired_action_taken text;
  desired_crm_target_status text;
  desired_lock_token uuid;
  acquired_lock_token uuid;
  prior_ten_minute_cancel_count integer;
  prior_thirty_minute_cancel_count integer;
  prior_cancel_count integer;
  sent_message_count integer;
  daily_hard_ceiling integer;
  breaker_threshold integer;
  breaker_reason text;
begin
  if p_raw_token is null
     or p_raw_token !~ '^[A-Za-z0-9_-]{20,128}$'
     or p_nonce is null
     or p_nonce !~ '^[A-Za-z0-9_-]{20,128}$'
     or p_action not in ('confirm', 'cancel', 'opt_out') then
    return query select false, 'invalid_or_expired', null::bigint, null::text, null::text, null::uuid, null::text, null::timestamptz, null::text;
    return;
  end if;

  if p_action = 'opt_out' then
    select *
      into reminder
      from app.reminder_messages
     where tracking_token_digest = private.token_digest(p_raw_token)
       and token_expires_at > app.now()
       and superseded_at is null
       and status in ('sent', 'delivered', 'send_unknown')
     limit 1
     for update;

    if not found or reminder.patient_id is null then
      return query select false, 'invalid_or_expired', null::bigint, null::text, null::text, null::uuid, null::text, null::timestamptz, null::text;
      return;
    end if;

    if exists (
      select 1
        from app.patients patient
       where patient.id = reminder.patient_id
         and patient.sms_reminders_enabled is false
         and patient.sms_reminders_status = 'opted_out'
       for update
    ) then
      return query select
        true,
        null::text,
        reminder.id,
        reminder.cliniccards_visit_id,
        null::text,
        null::uuid,
        reminder.action_taken,
        reminder.target_at,
        reminder.patient_display_snapshot;
      return;
    end if;

    insert into app.consent_events(
      patient_id,
      status,
      source,
      legal_basis,
      captured_at,
      captured_by,
      request_meta
    )
    values (
      reminder.patient_id,
      'opted_out',
      'unsubscribe_link',
      'contract',
      app.now(),
      'confirm_page',
      jsonb_build_object('message_id', reminder.id)
    )
    returning id into consent_event_id;

    update app.patients
       set sms_reminders_enabled = false,
           sms_reminders_status = 'opted_out',
           last_consent_event_id = consent_event_id,
           sms_reminders_set_at = app.now(),
           updated_at = app.now()
     where id = reminder.patient_id;

    return query select
      true,
      null::text,
      reminder.id,
      reminder.cliniccards_visit_id,
      null::text,
      null::uuid,
      reminder.action_taken,
      reminder.target_at,
      reminder.patient_display_snapshot;
    return;
  end if;

  select *
    into reminder
    from app.reminder_messages
   where tracking_token_digest = private.token_digest(p_raw_token)
     and action_nonce_digest = private.token_digest(p_nonce)
     and action_nonce_expires_at > app.now()
     and token_expires_at > app.now()
     and superseded_at is null
     and status in ('sent', 'delivered', 'send_unknown')
     and action_locked_at is null
   for update;

  if not found then
    return query select false, 'invalid_or_expired', null::bigint, null::text, null::text, null::uuid, null::text, null::timestamptz, null::text;
    return;
  end if;

  desired_action_taken := case p_action
    when 'confirm' then 'confirmed'
    else 'cancelled'
  end;
  desired_crm_target_status := case p_action
    when 'confirm' then 'CONFIRMED'
    else 'CANCELLED'
  end;

  if p_action = 'cancel' then
    perform pg_catalog.pg_advisory_xact_lock(
      pg_catalog.hashtext('dentino.cancel.breaker'),
      pg_catalog.hashtext(reminder.target_date::text)
    );

    select
      count(*) filter (
        where message.responded_at >= app.now() - interval '10 minutes'
      )::integer,
      count(*) filter (
        where message.responded_at >= app.now() - interval '30 minutes'
      )::integer,
      count(*)::integer
      into prior_ten_minute_cancel_count,
           prior_thirty_minute_cancel_count,
           prior_cancel_count
      from app.reminder_messages message
     where message.target_date = reminder.target_date
       and message.id <> reminder.id
       and message.response = 'cancel'
       and message.responded_at is not null
       and message.responded_at <= app.now()
       and message.action_locked_at is not null;

    select count(*)::integer
      into sent_message_count
      from app.reminder_messages message
     where message.target_date = reminder.target_date
       and message.superseded_at is null
       and message.status in ('sent', 'delivered', 'send_unknown');

    daily_hard_ceiling := greatest(
      8,
      ceiling(coalesce(sent_message_count, 0)::numeric * 0.6)::integer
    );
    breaker_threshold := null;
    breaker_reason := null;

    if coalesce(prior_ten_minute_cancel_count, 0) + 1 >= 4 then
      breaker_threshold := 4;
      breaker_reason := 'cancel_velocity';
    elsif coalesce(prior_thirty_minute_cancel_count, 0) + 1 >= 6 then
      breaker_threshold := 6;
      breaker_reason := 'cancel_velocity';
    elsif coalesce(prior_cancel_count, 0) + 1 > daily_hard_ceiling then
      breaker_threshold := daily_hard_ceiling;
      breaker_reason := 'cancel_daily_ceiling';
    end if;

    if breaker_threshold is not null then
      insert into app.cancellation_circuits as circuit (
        target_date,
        threshold,
        status,
        opened_at,
        opened_reason
      )
      values (
        reminder.target_date,
        breaker_threshold,
        'open',
        app.now(),
        breaker_reason
      )
      on conflict (target_date) do update
         set threshold = case
               when circuit.status = 'open'
                 then least(circuit.threshold, excluded.threshold)
               else excluded.threshold
             end,
             status = 'open',
             opened_at = case
               when circuit.status = 'open'
                 then coalesce(circuit.opened_at, excluded.opened_at)
               else excluded.opened_at
             end,
             opened_reason = case
               when circuit.status = 'open'
                 then coalesce(circuit.opened_reason, excluded.opened_reason)
               else excluded.opened_reason
             end;
    end if;

    if exists (
      select 1
        from app.cancellation_circuits c
       where c.target_date = reminder.target_date
         and c.status = 'open'
    ) then
      desired_action_taken := 'pending_staff_review';
      desired_crm_target_status := null;
    end if;
  end if;

  if desired_crm_target_status is not null then
    desired_lock_token := extensions.gen_random_uuid();

    insert into app.crm_visit_write_locks as write_lock (
      cliniccards_visit_id,
      lock_token,
      locked_by_message_id,
      locked_at,
      lock_expires_at
    )
    values (
      reminder.cliniccards_visit_id,
      desired_lock_token,
      reminder.id,
      app.now(),
      app.now() + interval '90 seconds'
    )
    on conflict on constraint crm_visit_write_locks_pkey do update
       set lock_token = excluded.lock_token,
           locked_by_message_id = excluded.locked_by_message_id,
           locked_at = excluded.locked_at,
           lock_expires_at = excluded.lock_expires_at
     where write_lock.lock_expires_at < app.now()
    returning write_lock.lock_token
      into acquired_lock_token;

    if acquired_lock_token is null then
      return query select false, 'write_lock_busy', null::bigint, null::text, null::text, null::uuid, null::text, null::timestamptz, null::text;
      return;
    end if;
  end if;

  update app.reminder_messages
     set response = p_action,
         responded_at = app.now(),
         action_locked_at = app.now(),
         action_taken = desired_action_taken,
         status = case when status = 'send_unknown' then 'delivered' else status end,
         action_nonce_digest = null,
         action_nonce_expires_at = null
   where id = reminder.id
     and action_locked_at is null;

  return query select
    true,
    null::text,
    reminder.id,
    reminder.cliniccards_visit_id,
    desired_crm_target_status,
    acquired_lock_token,
    desired_action_taken,
    reminder.target_at,
    reminder.patient_display_snapshot;
end;
$$;

create or replace function api.finish_reminder_action(
  p_message_id bigint,
  p_ok boolean,
  p_error text default null,
  p_meta jsonb default '{}'::jsonb
)
returns table (
  ok boolean,
  neutral_reason text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  updated_count integer;
  supplied_lock_token uuid := nullif(p_meta->>'lock_token', '')::uuid;
begin
  update app.reminder_messages
     set crm_writeback_ok = p_ok,
         action_taken = case
           when p_ok then action_taken
           when action_taken in ('confirmed', 'cancelled') then 'error'
           else action_taken
         end,
         error = case when p_ok then null else left(coalesce(p_error, 'crm write-back failed'), 1000) end
   where id = p_message_id
     and action_locked_at is not null;

  get diagnostics updated_count = row_count;

  if supplied_lock_token is not null then
    delete from app.crm_visit_write_locks
     where locked_by_message_id = p_message_id
       and lock_token = supplied_lock_token;
  else
    delete from app.crm_visit_write_locks
     where locked_by_message_id = p_message_id;
  end if;

  if updated_count = 0 then
    return query select false, 'not_found'::text;
    return;
  end if;

  return query select true, null::text;
end;
$$;

alter function api.lookup_reminder_by_token(text) owner to dentino_confirm_definer;
alter function api.prepare_reminder_action(text, text) owner to dentino_confirm_definer;
alter function api.record_reminder_action(text, text, text) owner to dentino_confirm_definer;
alter function api.finish_reminder_action(bigint, boolean, text, jsonb) owner to dentino_confirm_definer;

revoke execute on all functions in schema api from public, anon, authenticated, dentino_run_api, dentino_maintenance_runner;
grant execute on function api.lookup_reminder_by_token(text) to dentino_confirm_api;
grant execute on function api.prepare_reminder_action(text, text) to dentino_confirm_api;
grant execute on function api.record_reminder_action(text, text, text) to dentino_confirm_api;
grant execute on function api.finish_reminder_action(bigint, boolean, text, jsonb) to dentino_confirm_api;

alter function maintenance.reap_stale_sends(date) owner to dentino_maintenance_definer;
alter function maintenance.purge_privacy() owner to dentino_maintenance_definer;
revoke execute on function maintenance.reap_stale_sends(date) from public, anon, authenticated, dentino_confirm_api, dentino_run_api;
revoke execute on function maintenance.purge_privacy() from public, anon, authenticated, dentino_confirm_api, dentino_run_api;
grant execute on function maintenance.reap_stale_sends(date) to dentino_maintenance_runner;
grant execute on function maintenance.purge_privacy() to dentino_maintenance_runner;
