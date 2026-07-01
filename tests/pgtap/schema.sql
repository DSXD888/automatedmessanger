begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;

select plan(52);

select ok(exists (select 1 from information_schema.schemata where schema_name = 'app'), 'app schema exists');
select ok(exists (select 1 from information_schema.schemata where schema_name = 'maintenance'), 'maintenance schema exists');

select is(
  (select count(*)::int from information_schema.tables where table_schema = 'app' and table_type = 'BASE TABLE'),
  13,
  'app schema has exactly 13 base tables'
);

select ok(to_regclass('app.patients') is not null, 'patients table exists');
select ok(to_regclass('app.reminder_runs') is not null, 'reminder_runs table exists');
select ok(to_regclass('app.reminder_days') is not null, 'reminder_days table exists');
select ok(to_regclass('app.reminder_messages') is not null, 'reminder_messages table exists');
select ok(to_regclass('app.message_templates') is not null, 'message_templates table exists');
select ok(to_regclass('app.cliniccards_status_policy') is not null, 'cliniccards_status_policy table exists');
select ok(to_regclass('app.consent_events') is not null, 'consent_events table exists');
select ok(to_regclass('app.cancellation_circuits') is not null, 'cancellation_circuits table exists');
select ok(to_regclass('app.crm_visit_write_locks') is not null, 'crm_visit_write_locks table exists');
select ok(to_regclass('app.inbound_events') is not null, 'inbound_events table exists');
select ok(to_regclass('app.crm_fetch_log') is not null, 'crm_fetch_log table exists');
select ok(to_regclass('app.crm_visit_facts') is not null, 'crm_visit_facts table exists');
select ok(to_regclass('app.audit_log') is not null, 'audit_log table exists');

select ok(exists (
  select 1 from information_schema.columns
  where table_schema = 'app' and table_name = 'reminder_messages' and column_name = 'channel'
), 'reminder_messages.channel exists');

select ok(exists (
  select 1 from information_schema.columns
  where table_schema = 'app' and table_name = 'message_templates' and column_name = 'buttons'
), 'message_templates.buttons exists');

select ok(exists (
  select 1 from information_schema.columns
  where table_schema = 'app' and table_name = 'reminder_messages' and column_name = 'appointment_fingerprint'
), 'reminder_messages.appointment_fingerprint exists');

select ok(exists (
  select 1 from information_schema.columns
  where table_schema = 'app' and table_name = 'crm_visit_facts' and column_name = 'purpose'
), 'crm_visit_facts.purpose exists');

select ok(exists (
  select 1 from information_schema.columns
  where table_schema = 'app' and table_name = 'crm_visit_facts' and column_name = 'appointment_fingerprint'
), 'crm_visit_facts.appointment_fingerprint exists');

select ok(exists (
  select 1
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'app'
    and r.relname = 'reminder_messages'
    and c.conname = 'one_action_requires_lock'
    and c.contype = 'c'
), 'one_action_requires_lock check exists');

select ok(exists (
  select 1
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'app'
    and r.relname = 'reminder_messages'
    and c.conname = 'claimed_or_live_token_required'
    and c.contype = 'c'
), 'claimed_or_live_token_required check exists');

select ok(exists (
  select 1
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'app'
    and r.relname = 'crm_fetch_log'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%visits_initial%'
    and pg_get_constraintdef(c.oid) like '%writeback_post%'
), 'crm_fetch_log purpose check exists');

select ok(exists (
  select 1
  from pg_trigger t
  join pg_class r on r.oid = t.tgrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'app'
    and r.relname = 'reminder_messages'
    and t.tgname = 'reminder_messages_action_lock_guard'
    and not t.tgisinternal
), 'reminder_messages_action_lock_guard trigger exists');

select ok(to_regclass('app.reminder_messages_one_ordinary_per_day') is not null, 'ordinary reminder partial unique index exists');
select ok(to_regclass('app.reminder_messages_one_notice_per_fingerprint') is not null, 'change notice partial unique index exists');
select ok(to_regclass('app.message_templates_one_active') is not null, 'one-active template partial unique index exists');
select ok(to_regclass('app.reminder_messages_provider_message_id_uq') is not null, 'provider message id partial unique index exists');
select ok(to_regclass('app.reminder_messages_by_target_date') is not null, 'target-date runtime index exists');
select ok(to_regclass('app.reminder_messages_needs_attention') is not null, 'needs-attention runtime index exists');

select is(
  (
    select count(*)::int
      from app.message_templates
     where key = 'appointment_reminder'
       and channel = 'sms'
       and language = 'uk'
       and active is true
  ),
  1,
  'fresh DB seeds exactly one active appointment reminder SMS template'
);

select is(
  (
    select body
      from app.message_templates
     where key = 'appointment_reminder'
       and channel = 'sms'
       and language = 'uk'
       and active is true
  ),
  $body${{name}}, ваш візит: завтра {{date}} о {{time}}.
Підтвердити/змінити: {{confirm_url}}. Тел: {{clinic_phone}}$body$,
  'seeded appointment reminder body matches the canonical Ukrainian copy'
);

select ok(to_regprocedure('app.now()') is not null, 'app.now() exists');
select ok(to_regprocedure('app.appointment_fingerprint(timestamptz,timestamptz,text,text,text,text)') is not null, 'app.appointment_fingerprint() exists');
select ok(to_regprocedure('maintenance.reap_stale_sends(date)') is not null, 'maintenance.reap_stale_sends(date) exists');
select ok(to_regprocedure('maintenance.purge_privacy()') is not null, 'maintenance.purge_privacy() exists');

select set_config('app.env', 'test', false);
select set_config('app.test_now', '2026-06-30 09:00:00+00', false);
select is(app.now(), '2026-06-30 09:00:00+00'::timestamptz, 'app.now() reads app.test_now under app.env=test');

select is(
  app.appointment_fingerprint('2026-07-01 09:00+00', '2026-07-01 10:00+00', 'PLANNED', 'doc-1', 'cab-1', 'patient-1'),
  app.appointment_fingerprint('2026-07-01 09:00+00', '2026-07-01 10:00+00', 'PLANNED', 'doc-1', 'cab-1', 'patient-1'),
  'appointment_fingerprint is deterministic'
);

select isnt(
  app.appointment_fingerprint('2026-07-01 09:00+00', '2026-07-01 10:00+00', 'PLANNED', 'doc-1', 'cab-1', 'patient-1'),
  app.appointment_fingerprint('2026-07-01 09:00+00', '2026-07-01 10:00+00', 'CONFIRMED', 'doc-1', 'cab-1', 'patient-1'),
  'appointment_fingerprint changes when message-salient facts change'
);

select ok(exists (
  select 1
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'app'
    and r.relname = 'reminder_messages'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%message_kind%'
    and pg_get_constraintdef(c.oid) not like '%no_reply_nudge%'
), 'v1 message_kind check does not activate no_reply_nudge');

select ok((select remindable from app.cliniccards_status_policy where status = 'PLANNED'), 'PLANNED is seeded as remindable');
select ok(not (select remindable from app.cliniccards_status_policy where status = 'BOOKING'), 'BOOKING is seeded fail-closed');
select ok((select count(*) >= 10 from app.cliniccards_status_policy), 'status policy seed has documented baseline statuses');

create or replace function pg_temp.violates_one_action_requires_lock()
returns boolean
language plpgsql
as $$
declare
  run_id bigint;
  patient_id bigint;
begin
  insert into app.reminder_runs(run_date, target_date, trigger)
  values ('2026-06-30', '2026-07-01', 'manual')
  returning id into run_id;

  insert into app.patients(cliniccards_id)
  values ('patient-lock-' || extensions.gen_random_uuid()::text)
  returning id into patient_id;

  begin
    insert into app.reminder_messages(
      run_id, cliniccards_visit_id, patient_id, target_date, target_at, response
    )
    values (
      run_id, 'visit-lock-' || extensions.gen_random_uuid()::text, patient_id,
      '2026-07-01', '2026-07-01 09:00+00', 'confirm'
    );
  exception when check_violation then
    return true;
  end;

  return false;
end;
$$;

select ok(pg_temp.violates_one_action_requires_lock(), 'response without action lock is rejected');

create or replace function pg_temp.violates_claimed_or_live_token_required()
returns boolean
language plpgsql
as $$
declare
  run_id bigint;
  patient_id bigint;
begin
  insert into app.reminder_runs(run_date, target_date, trigger)
  values ('2026-06-30', '2026-07-01', 'manual')
  returning id into run_id;

  insert into app.patients(cliniccards_id)
  values ('patient-token-' || extensions.gen_random_uuid()::text)
  returning id into patient_id;

  begin
    insert into app.reminder_messages(
      run_id, cliniccards_visit_id, patient_id, target_date, target_at, status
    )
    values (
      run_id, 'visit-token-' || extensions.gen_random_uuid()::text, patient_id,
      '2026-07-01', '2026-07-01 09:00+00', 'sent'
    );
  exception when check_violation then
    return true;
  end;

  return false;
end;
$$;

select ok(pg_temp.violates_claimed_or_live_token_required(), 'sent rows require token digest and expiry');

create or replace function pg_temp.rejects_action_rewrite()
returns boolean
language plpgsql
as $$
declare
  run_id bigint;
  patient_id bigint;
  message_id bigint;
begin
  insert into app.reminder_runs(run_date, target_date, trigger)
  values ('2026-06-30', '2026-07-01', 'manual')
  returning id into run_id;

  insert into app.patients(cliniccards_id)
  values ('patient-rewrite-' || extensions.gen_random_uuid()::text)
  returning id into patient_id;

  insert into app.reminder_messages(
    run_id, cliniccards_visit_id, patient_id, target_date, target_at, status,
    tracking_token_digest, token_expires_at, response, responded_at, action_locked_at, action_taken
  )
  values (
    run_id, 'visit-rewrite-' || extensions.gen_random_uuid()::text, patient_id,
    '2026-07-01', '2026-07-01 09:00+00', 'sent',
    extensions.gen_random_bytes(32), '2026-07-01 09:00+00',
    'confirm', app.now(), app.now(), 'confirmed'
  )
  returning id into message_id;

  begin
    update app.reminder_messages set response = 'cancel' where id = message_id;
  exception when raise_exception then
    return true;
  end;

  return false;
end;
$$;

select ok(pg_temp.rejects_action_rewrite(), 'action lock trigger rejects re-response');

create or replace function pg_temp.rejects_duplicate_template()
returns boolean
language plpgsql
as $$
begin
  insert into app.message_templates(key, channel, language, body)
  values ('confirm_cancel_' || extensions.gen_random_uuid()::text, 'sms', 'uk', 'one');

  begin
    insert into app.message_templates(key, channel, language, body)
    select key, channel, language, 'two'
    from app.message_templates
    order by id desc
    limit 1;
  exception when unique_violation then
    return true;
  end;

  return false;
end;
$$;

select ok(pg_temp.rejects_duplicate_template(), 'duplicate active template is rejected');

create or replace function pg_temp.rejects_duplicate_ordinary()
returns boolean
language plpgsql
as $$
declare
  run_id bigint;
  visit_id text := 'visit-ordinary-' || extensions.gen_random_uuid()::text;
begin
  insert into app.reminder_runs(run_date, target_date, trigger)
  values ('2026-06-30', '2026-07-01', 'manual')
  returning id into run_id;

  insert into app.reminder_messages(run_id, cliniccards_visit_id, target_date, target_at, message_kind)
  values (run_id, visit_id, '2026-07-01', '2026-07-01 09:00+00', 'initial_reminder');

  begin
    insert into app.reminder_messages(run_id, cliniccards_visit_id, target_date, target_at, message_kind)
    values (run_id, visit_id, '2026-07-01', '2026-07-01 09:00+00', 'catchup_reminder');
  exception when unique_violation then
    return true;
  end;

  return false;
end;
$$;

select ok(pg_temp.rejects_duplicate_ordinary(), 'ordinary reminder idempotency key rejects duplicates');

create or replace function pg_temp.rejects_duplicate_notice()
returns boolean
language plpgsql
as $$
declare
  run_id bigint;
  visit_id text := 'visit-notice-' || extensions.gen_random_uuid()::text;
begin
  insert into app.reminder_runs(run_date, target_date, trigger)
  values ('2026-06-30', '2026-07-01', 'manual')
  returning id into run_id;

  insert into app.reminder_messages(
    run_id, cliniccards_visit_id, target_date, target_at, message_kind, appointment_fingerprint
  )
  values (run_id, visit_id, '2026-07-01', '2026-07-01 09:00+00', 'time_change_notice', 'same-fingerprint');

  begin
    insert into app.reminder_messages(
      run_id, cliniccards_visit_id, target_date, target_at, message_kind, appointment_fingerprint
    )
    values (run_id, visit_id, '2026-07-01', '2026-07-01 09:00+00', 'time_change_notice', 'same-fingerprint');
  exception when unique_violation then
    return true;
  end;

  return false;
end;
$$;

select ok(pg_temp.rejects_duplicate_notice(), 'change notice fingerprint idempotency key rejects duplicates');

create or replace function pg_temp.rejects_short_digest()
returns boolean
language plpgsql
as $$
declare
  run_id bigint;
begin
  insert into app.reminder_runs(run_date, target_date, trigger)
  values ('2026-06-30', '2026-07-01', 'manual')
  returning id into run_id;

  begin
    insert into app.reminder_messages(
      run_id, cliniccards_visit_id, target_date, target_at, status, tracking_token_digest, token_expires_at
    )
    values (
      run_id, 'visit-short-digest-' || extensions.gen_random_uuid()::text,
      '2026-07-01', '2026-07-01 09:00+00', 'sent', decode('aa', 'hex'), '2026-07-01 09:00+00'
    );
  exception when check_violation then
    return true;
  end;

  return false;
end;
$$;

select ok(pg_temp.rejects_short_digest(), 'tracking token digest must be 32 bytes');

select ok(exists (
  select 1
  from pg_index i
  join pg_class r on r.oid = i.indrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'app'
    and r.relname = 'crm_visit_facts'
    and i.indisprimary
    and pg_get_indexdef(i.indexrelid) like '%run_id%'
    and pg_get_indexdef(i.indexrelid) like '%cliniccards_visit_id%'
    and pg_get_indexdef(i.indexrelid) like '%purpose%'
), 'crm_visit_facts primary key includes run_id, cliniccards_visit_id, and purpose');

select * from finish();

rollback;
