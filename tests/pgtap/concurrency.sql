begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
select set_config('app.env', 'test', false);
select set_config('app.test_now', '2026-06-30 09:00:00+00', false);

do $$
begin
  execute format('grant dentino_run_api to %I', current_user);
  execute format('grant dentino_confirm_api to %I', current_user);
end;
$$;

select plan(43);

create or replace function pg_temp.claim_day(
  p_target_date date,
  p_run_id bigint,
  p_lock_token uuid,
  p_now timestamptz,
  p_pass_kind text
)
returns boolean
language plpgsql
as $$
declare
  claimed boolean;
begin
  insert into app.reminder_days(
    target_date,
    status,
    locked_by_run_id,
    lock_token,
    lock_started_at,
    lock_heartbeat_at,
    lock_expires_at
  )
  values (
    p_target_date,
    'running',
    p_run_id,
    p_lock_token,
    p_now,
    p_now,
    p_now + interval '15 minutes'
  )
  on conflict (target_date) do update
  set status = 'running',
      locked_by_run_id = excluded.locked_by_run_id,
      lock_token = excluded.lock_token,
      lock_started_at = excluded.lock_started_at,
      lock_heartbeat_at = excluded.lock_heartbeat_at,
      lock_expires_at = excluded.lock_expires_at,
      updated_at = p_now
  where (
      app.reminder_days.status <> 'running'
      or app.reminder_days.lock_expires_at <= p_now
      or app.reminder_days.lock_heartbeat_at < p_now - interval '120 seconds'
    )
    and (
      app.reminder_days.status <> 'completed'
      or p_pass_kind <> 'initial'
    )
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

create or replace function pg_temp.claim_message_for_send(
  p_message_id bigint,
  p_claim_token uuid,
  p_now timestamptz
)
returns bigint
language plpgsql
as $$
declare
  claimed_id bigint;
begin
  with candidate as (
    select id
      from app.reminder_messages
     where id = p_message_id
       and tracking_token_digest is null
       and (
         status = 'pending'
         or (status = 'failed' and skip_reason = 'provider_pre_submit_failure')
       )
     for update skip locked
  )
  update app.reminder_messages message
     set status = 'sending',
         send_claim_token = p_claim_token,
         send_claim_expires_at = p_now + interval '5 minutes',
         send_attempt_count = send_attempt_count + 1,
         last_attempt_at = p_now,
         tracking_token_digest = extensions.gen_random_bytes(32),
         token_expires_at = p_now + interval '1 day'
    from candidate
   where message.id = candidate.id
   returning message.id into claimed_id;

  return claimed_id;
end;
$$;

create or replace function pg_temp.commit_message_send(
  p_message_id bigint,
  p_claim_token uuid
)
returns int
language plpgsql
as $$
declare
  updated_count int;
begin
  update app.reminder_messages
     set status = 'sent',
         provider_message_id = 'provider-' || p_message_id::text,
         send_claim_token = null,
         send_claim_expires_at = null
   where id = p_message_id
     and status = 'sending'
     and send_claim_token = p_claim_token;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create temp table day_claim_case(
  target_date date not null,
  first_run_id bigint not null,
  second_run_id bigint not null,
  catchup_run_id bigint not null,
  first_token uuid not null,
  second_token uuid not null,
  catchup_token uuid not null
);

with inserted as (
  insert into app.reminder_runs(run_date, target_date, trigger, pass_kind)
  values
    ('2026-06-30', '2026-07-02', 'cron', 'initial'),
    ('2026-06-30', '2026-07-02', 'cron', 'initial'),
    ('2026-06-30', '2026-07-02', 'manual', 'catchup')
  returning id
),
numbered as (
  select id, row_number() over (order by id) as ordinal
    from inserted
)
insert into day_claim_case(
  target_date,
  first_run_id,
  second_run_id,
  catchup_run_id,
  first_token,
  second_token,
  catchup_token
)
select
  '2026-07-02',
  max(id) filter (where ordinal = 1),
  max(id) filter (where ordinal = 2),
  max(id) filter (where ordinal = 3),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid()
from numbered;

create temp table message_claim_case(
  pending_message_id bigint not null,
  retry_message_id bigint not null,
  terminal_message_id bigint not null,
  first_token uuid not null,
  second_token uuid not null,
  retry_token uuid not null
);

with run as (
  insert into app.reminder_runs(run_date, target_date, trigger, pass_kind)
  values ('2026-06-30', '2026-07-03', 'manual', 'initial')
  returning id
),
pending_message as (
  insert into app.reminder_messages(
    run_id,
    cliniccards_visit_id,
    target_date,
    target_at,
    message_kind,
    appointment_fingerprint
  )
  select
    id,
    'visit-send-claim-pending',
    '2026-07-03',
    '2026-07-03 09:00+00',
    'initial_reminder',
    'pending-fingerprint'
  from run
  returning id
),
retry_message as (
  insert into app.reminder_messages(
    run_id,
    cliniccards_visit_id,
    target_date,
    target_at,
    message_kind,
    appointment_fingerprint,
    status,
    skip_reason
  )
  select
    id,
    'visit-send-claim-retry',
    '2026-07-03',
    '2026-07-03 10:00+00',
    'initial_reminder',
    'retry-fingerprint',
    'failed',
    'provider_pre_submit_failure'
  from run
  returning id
),
terminal_message as (
  insert into app.reminder_messages(
    run_id,
    cliniccards_visit_id,
    target_date,
    target_at,
    message_kind,
    appointment_fingerprint,
    status,
    skip_reason
  )
  select
    id,
    'visit-send-claim-terminal',
    '2026-07-03',
    '2026-07-03 11:00+00',
    'initial_reminder',
    'terminal-fingerprint',
    'failed',
    'send_ambiguous'
  from run
  returning id
)
insert into message_claim_case(
  pending_message_id,
  retry_message_id,
  terminal_message_id,
  first_token,
  second_token,
  retry_token
)
select
  (select id from pending_message),
  (select id from retry_message),
  (select id from terminal_message),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid(),
  extensions.gen_random_uuid();

create temp table action_cas_case(
  message_id bigint not null,
  raw_token text not null
);

with run as (
  insert into app.reminder_runs(run_date, target_date, trigger, pass_kind)
  values ('2026-06-30', '2026-07-04', 'manual', 'initial')
  returning id
),
message as (
  insert into app.reminder_messages(
    run_id,
    cliniccards_visit_id,
    target_date,
    target_at,
    message_kind,
    appointment_fingerprint,
    status,
    tracking_token_digest,
    token_expires_at
  )
  select
    id,
    'visit-action-cas',
    '2026-07-04',
    '2026-07-04 09:00+00',
    'initial_reminder',
    'action-cas-fingerprint',
    'send_unknown',
    private.token_digest('token-action-cas-0001'),
    app.now() + interval '1 day'
  from run
  returning id
)
insert into action_cas_case(message_id, raw_token)
select id, 'token-action-cas-0001' from message;

create temp table write_lock_case(
  visit_id text not null,
  first_message_id bigint not null,
  second_message_id bigint not null,
  first_raw_token text not null,
  second_raw_token text not null
);

with run as (
  insert into app.reminder_runs(run_date, target_date, trigger, pass_kind)
  values ('2026-06-30', '2026-07-05', 'manual', 'initial')
  returning id
),
first_message as (
  insert into app.reminder_messages(
    run_id,
    cliniccards_visit_id,
    target_date,
    target_at,
    message_kind,
    appointment_fingerprint,
    status,
    tracking_token_digest,
    token_expires_at
  )
  select
    id,
    'visit-write-lock-rpc',
    '2026-07-05',
    '2026-07-05 09:00+00',
    'initial_reminder',
    'write-lock-first-fingerprint',
    'sent',
    private.token_digest('token-write-lock-0001'),
    app.now() + interval '1 day'
  from run
  returning id
),
second_message as (
  insert into app.reminder_messages(
    run_id,
    cliniccards_visit_id,
    target_date,
    target_at,
    message_kind,
    appointment_fingerprint,
    status,
    tracking_token_digest,
    token_expires_at
  )
  select
    id,
    'visit-write-lock-rpc',
    '2026-07-05',
    '2026-07-05 09:00+00',
    'time_change_notice',
    'write-lock-second-fingerprint',
    'sent',
    private.token_digest('token-write-lock-0002'),
    app.now() + interval '1 day'
  from run
  returning id
)
insert into write_lock_case(
  visit_id,
  first_message_id,
  second_message_id,
  first_raw_token,
  second_raw_token
)
select
  'visit-write-lock-rpc',
  (select id from first_message),
  (select id from second_message),
  'token-write-lock-0001',
  'token-write-lock-0002';

create temp table action_cas_prepare as
select * from api.prepare_reminder_action('token-action-cas-0001', 'confirm')
with no data;
create temp table action_cas_recorded as
select * from api.record_reminder_action('token-action-cas-0001', 'confirm', 'nonce')
with no data;
create temp table action_cas_second_recorded as
select * from api.record_reminder_action('token-action-cas-0001', 'cancel', 'nonce')
with no data;
create temp table write_lock_first_prepare as
select * from api.prepare_reminder_action('token-write-lock-0001', 'confirm')
with no data;
create temp table write_lock_first_record as
select * from api.record_reminder_action('token-write-lock-0001', 'confirm', 'nonce')
with no data;
create temp table write_lock_second_prepare as
select * from api.prepare_reminder_action('token-write-lock-0002', 'confirm')
with no data;
create temp table write_lock_second_busy as
select * from api.record_reminder_action('token-write-lock-0002', 'confirm', 'nonce')
with no data;
create temp table write_lock_second_record as
select * from api.record_reminder_action('token-write-lock-0002', 'confirm', 'nonce')
with no data;
create temp table write_lock_stale_finish as
select * from api.finish_reminder_action(null::bigint, true, null::text, '{}'::jsonb)
with no data;
create temp table write_lock_current_finish as
select * from api.finish_reminder_action(null::bigint, true, null::text, '{}'::jsonb)
with no data;
create temp table write_lock_snapshots(
  phase text primary key,
  locked_by_message_id bigint,
  lock_token uuid,
  lock_count integer not null
);

grant select on action_cas_case, write_lock_case to dentino_confirm_api;
grant insert, select on
  action_cas_prepare,
  action_cas_recorded,
  action_cas_second_recorded,
  write_lock_first_prepare,
  write_lock_first_record,
  write_lock_second_prepare,
  write_lock_second_busy,
  write_lock_second_record,
  write_lock_stale_finish,
  write_lock_current_finish,
  write_lock_snapshots
to dentino_confirm_api;

set local role dentino_confirm_api;

insert into action_cas_prepare
select *
from api.prepare_reminder_action(
  (select raw_token from action_cas_case),
  'confirm'
);

insert into action_cas_recorded
select *
from api.record_reminder_action(
  (select raw_token from action_cas_case),
  'confirm',
  (select action_nonce from action_cas_prepare)
);

insert into action_cas_second_recorded
select *
from api.record_reminder_action(
  (select raw_token from action_cas_case),
  'cancel',
  (select action_nonce from action_cas_prepare)
);

insert into write_lock_first_prepare
select *
from api.prepare_reminder_action(
  (select first_raw_token from write_lock_case),
  'confirm'
);

insert into write_lock_first_record
select *
from api.record_reminder_action(
  (select first_raw_token from write_lock_case),
  'confirm',
  (select action_nonce from write_lock_first_prepare)
);

reset role;

insert into write_lock_snapshots(phase, locked_by_message_id, lock_token, lock_count)
values (
  'after_first_record',
  (select locked_by_message_id from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case)),
  (select lock_token from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case)),
  (select count(*)::int from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case))
);

set local role dentino_confirm_api;

insert into write_lock_second_prepare
select *
from api.prepare_reminder_action(
  (select second_raw_token from write_lock_case),
  'confirm'
);

insert into write_lock_second_busy
select *
from api.record_reminder_action(
  (select second_raw_token from write_lock_case),
  'confirm',
  (select action_nonce from write_lock_second_prepare)
);

reset role;

insert into write_lock_snapshots(phase, locked_by_message_id, lock_token, lock_count)
values (
  'after_second_busy',
  (select locked_by_message_id from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case)),
  (select lock_token from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case)),
  (select count(*)::int from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case))
);

update app.crm_visit_write_locks
   set lock_expires_at = app.now() - interval '1 second'
 where cliniccards_visit_id = (select visit_id from write_lock_case);

set local role dentino_confirm_api;

insert into write_lock_second_record
select *
from api.record_reminder_action(
  (select second_raw_token from write_lock_case),
  'confirm',
  (select action_nonce from write_lock_second_prepare)
);

reset role;

insert into write_lock_snapshots(phase, locked_by_message_id, lock_token, lock_count)
values (
  'after_second_record',
  (select locked_by_message_id from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case)),
  (select lock_token from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case)),
  (select count(*)::int from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case))
);

set local role dentino_confirm_api;

insert into write_lock_stale_finish
select *
from api.finish_reminder_action(
  (select first_message_id from write_lock_case),
  true,
  null::text,
  jsonb_build_object('lock_token', (select lock_token from write_lock_first_record))
);

reset role;

insert into write_lock_snapshots(phase, locked_by_message_id, lock_token, lock_count)
values (
  'after_stale_finish',
  (select locked_by_message_id from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case)),
  (select lock_token from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case)),
  (select count(*)::int from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case))
);

set local role dentino_confirm_api;

insert into write_lock_current_finish
select *
from api.finish_reminder_action(
  (select second_message_id from write_lock_case),
  true,
  null::text,
  jsonb_build_object('lock_token', (select lock_token from write_lock_second_record))
);

reset role;

insert into write_lock_snapshots(phase, locked_by_message_id, lock_token, lock_count)
values (
  'after_current_finish',
  (select locked_by_message_id from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case)),
  (select lock_token from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case)),
  (select count(*)::int from app.crm_visit_write_locks where cliniccards_visit_id = (select visit_id from write_lock_case))
);

select ok(
  pg_temp.claim_day(
    (select target_date from day_claim_case),
    (select first_run_id from day_claim_case),
    (select first_token from day_claim_case),
    app.now(),
    'initial'
  ),
  'first reminder-day claimant wins the target-date lease'
);

select ok(
  not pg_temp.claim_day(
    (select target_date from day_claim_case),
    (select second_run_id from day_claim_case),
    (select second_token from day_claim_case),
    app.now() + interval '1 second',
    'initial'
  ),
  'second reminder-day claimant cannot steal a live lease'
);

update app.reminder_days
   set lock_heartbeat_at = app.now() + interval '30 seconds',
       lock_expires_at = app.now() + interval '15 minutes'
 where target_date = (select target_date from day_claim_case);

select ok(
  not pg_temp.claim_day(
    (select target_date from day_claim_case),
    (select second_run_id from day_claim_case),
    (select second_token from day_claim_case),
    app.now() + interval '60 seconds',
    'initial'
  ),
  'renewed reminder-day heartbeat within 30 seconds is not stolen'
);

select ok(
  pg_temp.claim_day(
    (select target_date from day_claim_case),
    (select second_run_id from day_claim_case),
    (select second_token from day_claim_case),
    app.now() + interval '151 seconds',
    'initial'
  ),
  'stopped reminder-day heartbeat is stealable before absolute TTL'
);

update app.reminder_days
   set status = 'completed',
       lock_expires_at = app.now() - interval '1 second'
 where target_date = (select target_date from day_claim_case);

select ok(
  not pg_temp.claim_day(
    (select target_date from day_claim_case),
    (select second_run_id from day_claim_case),
    (select second_token from day_claim_case),
    app.now() + interval '2 seconds',
    'initial'
  ),
  'completed initial reminder-day is not re-claimed by another initial pass'
);

select ok(
  pg_temp.claim_day(
    (select target_date from day_claim_case),
    (select catchup_run_id from day_claim_case),
    (select catchup_token from day_claim_case),
    app.now() + interval '3 seconds',
    'catchup'
  ),
  'catch-up pass may claim a completed initial reminder-day'
);

select is(
  pg_temp.claim_message_for_send(
    (select pending_message_id from message_claim_case),
    (select first_token from message_claim_case),
    app.now()
  ),
  (select pending_message_id from message_claim_case),
  'first send claimant atomically moves a pending message to sending'
);

select ok(
  pg_temp.claim_message_for_send(
    (select pending_message_id from message_claim_case),
    (select second_token from message_claim_case),
    app.now()
  ) is null,
  'second send claimant cannot claim an already-sending message'
);

select is(
  pg_temp.commit_message_send(
    (select pending_message_id from message_claim_case),
    (select second_token from message_claim_case)
  ),
  0,
  'stale send claimant cannot commit another claimant outcome'
);

select is(
  pg_temp.commit_message_send(
    (select pending_message_id from message_claim_case),
    (select first_token from message_claim_case)
  ),
  1,
  'winning send claimant commits exactly one outcome'
);

select is(
  pg_temp.claim_message_for_send(
    (select retry_message_id from message_claim_case),
    (select retry_token from message_claim_case),
    app.now()
  ),
  (select retry_message_id from message_claim_case),
  'retryable pre-submit failure may re-enter the send-claim path'
);

select ok(
  pg_temp.claim_message_for_send(
    (select terminal_message_id from message_claim_case),
    (select second_token from message_claim_case),
    app.now()
  ) is null,
  'non-retry terminal message is fenced from blind resend'
);

select is(
  (
    select recorded.ok::text || ':' ||
      recorded.action_taken || ':' ||
      recorded.crm_target_status || ':' ||
      message.status || ':' ||
      message.response || ':' ||
      (message.action_locked_at is not null)::text
    from action_cas_recorded recorded
    join app.reminder_messages message on message.id = recorded.message_id
  ),
  'true:confirmed:CONFIRMED:delivered:confirm:true',
  'record_reminder_action consumes the first action lock and promotes send_unknown to delivered'
);

select is(
  (
    select ok::text || ':' || neutral_reason
    from action_cas_second_recorded
  ),
  'false:invalid_or_expired',
  'second action through record_reminder_action is rejected after CAS'
);

select throws_like(
  $$
    update app.reminder_messages
       set action_locked_at = null,
           response = 'cancel'
     where id = (select message_id from action_cas_case)
  $$,
  '%single-use%',
  'action-lock trigger rejects unlock and re-response attempts'
);

select is(
  (
    select first_record.ok::text || ':' ||
      first_snapshot.lock_count::text || ':' ||
      first_snapshot.locked_by_message_id::text
    from write_lock_first_record first_record
    cross join write_lock_snapshots first_snapshot
    where first_snapshot.phase = 'after_first_record'
  ),
  'true:1:' || (select first_message_id::text from write_lock_case),
  'first record_reminder_action contender claims the visit write lease'
);

select is(
  (
    select second_busy.ok::text || ':' ||
      second_busy.neutral_reason || ':' ||
      busy_snapshot.lock_count::text || ':' ||
      busy_snapshot.locked_by_message_id::text
    from write_lock_second_busy second_busy
    cross join write_lock_snapshots busy_snapshot
    where busy_snapshot.phase = 'after_second_busy'
  ),
  'false:write_lock_busy:1:' || (select first_message_id::text from write_lock_case),
  'second live record_reminder_action contender does not win the visit write lease'
);

select is(
  (
    select second_record.ok::text || ':' ||
      stale_snapshot.lock_count::text || ':' ||
      stale_snapshot.locked_by_message_id::text
    from write_lock_second_record second_record
    cross join write_lock_snapshots stale_snapshot
    where stale_snapshot.phase = 'after_second_record'
  ),
  'true:1:' || (select second_message_id::text from write_lock_case),
  'stale visit write lease is stealable by record_reminder_action'
);

select is(
  (
    select stale_finish.ok::text || ':' ||
      after_stale.lock_count::text || ':' ||
      after_stale.locked_by_message_id::text
    from write_lock_stale_finish stale_finish
    cross join write_lock_snapshots after_stale
    where after_stale.phase = 'after_stale_finish'
  ),
  'true:1:' || (select second_message_id::text from write_lock_case),
  'stale owner finish_reminder_action cannot release the stealer lease'
);

select is(
  (
    select current_finish.ok::text || ':' ||
      after_current.lock_count::text
    from write_lock_current_finish current_finish
    cross join write_lock_snapshots after_current
    where after_current.phase = 'after_current_finish'
  ),
  'true:0',
  'current owner finish_reminder_action releases exactly one visit write lease'
);

select lives_ok(
  $$
    set local role dentino_run_api;
    select api.run_start_run(
      '2026-06-30'::date,
      '2026-07-08'::date,
      'manual',
      'initial',
      '2026-06-30 09:00:00+00'::timestamptz
    );
    reset role;
  $$,
  'run API role starts a reminder run through the DB store RPC'
);

select is(
  (
    select count(*)::int
      from app.reminder_runs
     where target_date = '2026-07-08'
       and trigger = 'manual'
       and pass_kind = 'initial'
       and status = 'running'
  ),
  1,
  'run_start_run writes a running reminder_runs row'
);

select lives_ok(
  $$
    set local role dentino_run_api;
    select api.run_claim_day(
      '2026-07-08'::date,
      (
        select id
          from app.reminder_runs
         where target_date = '2026-07-08'
         order by id desc
         limit 1
      ),
      'initial',
      '00000000-0000-0000-0000-000000000108'::uuid,
      '2026-06-30 09:00:01+00'::timestamptz
    );
    reset role;
  $$,
  'run API role claims the target-date lease through the DB store RPC'
);

select is(
  (
    select status
      from app.reminder_days
     where target_date = '2026-07-08'
  ),
  'running',
  'run_claim_day writes a running reminder_days lease row'
);

select lives_ok(
  $$
    set local role dentino_run_api;
    select api.run_record_fetch_logs(
      (
        select id
          from app.reminder_runs
         where target_date = '2026-07-08'
         order by id desc
         limit 1
      ),
      jsonb_build_array(jsonb_build_object(
        'purpose', 'visits_initial',
        'method', 'GET',
        'path', '/visits',
        'request_params', jsonb_build_object('date', '2026-07-08'),
        'response_status', 200,
        'raw_redacted', jsonb_build_object('appointments', 1),
        'raw_sha256_hex', repeat('b', 64),
        'fetched_at', '2026-06-30T09:00:02Z'
      ))
    );
    reset role;
  $$,
  'run API role records CRM fetch logs through the DB store RPC'
);

select is(
  (
    select count(*)::int
      from app.crm_fetch_log
     where path = '/visits'
       and request_params->>'date' = '2026-07-08'
  ),
  1,
  'run_record_fetch_logs writes the redacted fetch log row'
);

select lives_ok(
  $$
    set local role dentino_run_api;
    select api.run_record_visit_facts(
      (
        select id
          from app.reminder_runs
         where target_date = '2026-07-08'
         order by id desc
         limit 1
      ),
      jsonb_build_array(jsonb_build_object(
        'purpose', 'visits_initial',
        'target_date', '2026-07-08',
        'cliniccards_visit_id', 'visit-rpc-store',
        'cliniccards_patient_id', 'patient-rpc-store',
        'source_status', 'PLANNED',
        'remindable', true,
        'target_at', '2026-07-08T09:00:00Z',
        'appointment_fingerprint', 'fingerprint-rpc-store',
        'fetched_at', '2026-06-30T09:00:03Z'
      ))
    );
    reset role;
  $$,
  'run API role records CRM visit facts through the DB store RPC'
);

select is(
  (
    select count(*)::int
      from app.crm_visit_facts
     where cliniccards_visit_id = 'visit-rpc-store'
       and appointment_fingerprint = 'fingerprint-rpc-store'
  ),
  1,
  'run_record_visit_facts writes the visit fact row'
);

select lives_ok(
  $$
    set local role dentino_run_api;
    select api.run_materialize_message(
      (
        select id
          from app.reminder_runs
         where target_date = '2026-07-08'
         order by id desc
         limit 1
      ),
      'visit-rpc-store',
      'patient-rpc-store',
      '2026-07-08'::date,
      '2026-07-08 09:00:00+00'::timestamptz,
      'initial_reminder',
      'fingerprint-rpc-store',
      'PLANNED',
      'pending',
      null,
      'Synthetic Patient',
      '2026-06-30 09:00:04+00'::timestamptz
    );
    reset role;
  $$,
  'run API role materializes a reminder message through the DB store RPC'
);

select is(
  (
    select count(*)::int
      from app.reminder_messages m
      join app.patients p on p.id = m.patient_id
     where m.cliniccards_visit_id = 'visit-rpc-store'
       and p.cliniccards_id = 'patient-rpc-store'
       and m.status = 'pending'
  ),
  1,
  'run_materialize_message writes the patient and pending reminder row'
);

select lives_ok(
  $$
    set local role dentino_run_api;
    select api.run_claim_message_for_send(
      (
        select id
          from app.reminder_messages
         where cliniccards_visit_id = 'visit-rpc-store'
         order by id desc
         limit 1
      ),
      '00000000-0000-0000-0000-000000000109'::uuid,
      repeat('a', 64),
      '2026-07-09 09:00:00+00'::timestamptz,
      '2026-06-30 09:05:00+00'::timestamptz,
      '2026-06-30 09:00:05+00'::timestamptz
    );
    reset role;
  $$,
  'run API role atomically claims a message for send through the DB store RPC'
);

select is(
  (
    select status || ':' || encode(tracking_token_digest, 'hex')
      from app.reminder_messages
     where cliniccards_visit_id = 'visit-rpc-store'
  ),
  'sending:' || repeat('a', 64),
  'run_claim_message_for_send stores only the token digest and moves status to sending'
);

select lives_ok(
  $$
    set local role dentino_run_api;
    select api.run_commit_send_outcome(
      (
        select id
          from app.reminder_messages
         where cliniccards_visit_id = 'visit-rpc-store'
         order by id desc
         limit 1
      ),
      '00000000-0000-0000-0000-000000000109'::uuid,
      'sent',
      null,
      'provider-rpc-store',
      null,
      '2026-06-30 09:00:06+00'::timestamptz
    );
    reset role;
  $$,
  'run API role commits the winning send outcome through the DB store RPC'
);

select is(
  (
    select status || ':' || provider_message_id
      from app.reminder_messages
     where cliniccards_visit_id = 'visit-rpc-store'
  ),
  'sent:provider-rpc-store',
  'run_commit_send_outcome fences the send outcome and clears the claim'
);

select lives_ok(
  $$
    set local role dentino_run_api;
    select api.run_reconcile_day(
      '2026-07-08'::date,
      '2026-06-30 09:00:07+00'::timestamptz
    );
    reset role;
  $$,
  'run API role reconciles the day through the DB store RPC'
);

select is(
  (
    select status || ':' || health || ':' || sent_total::text
      from app.reminder_days
     where target_date = '2026-07-08'
  ),
  'completed:green:1',
  'run_reconcile_day records a green completed day'
);

select lives_ok(
  $$
    do $setup$
    declare
      old_run_id bigint;
      current_run_id bigint;
    begin
      insert into app.reminder_runs(run_date, target_date, trigger, pass_kind, status, started_at)
      values
        ('2026-06-30', '2026-07-09', 'manual', 'initial', 'completed', '2026-06-30 08:00:00+00')
      returning id into old_run_id;

      insert into app.reminder_runs(run_date, target_date, trigger, pass_kind, status, started_at)
      values
        ('2026-06-30', '2026-07-09', 'manual', 'catchup', 'running', '2026-06-30 09:00:00+00')
      returning id into current_run_id;

      insert into app.crm_fetch_log(
        run_id,
        purpose,
        method,
        path,
        request_params,
        response_status,
        raw_redacted,
        raw_sha256,
        fetched_at
      )
      values
        (
          old_run_id,
          'visits_initial',
          'GET',
          '/visits',
          jsonb_build_object('date', '2026-07-09'),
          200,
          jsonb_build_object('appointments', 3),
          decode(repeat('1', 64), 'hex'),
          '2026-06-30 08:00:00+00'
        ),
        (
          current_run_id,
          'catchup',
          'GET',
          '/visits',
          jsonb_build_object('date', '2026-07-09'),
          200,
          jsonb_build_object('appointments', 1),
          decode(repeat('2', 64), 'hex'),
          '2026-06-30 09:00:00+00'
        );

      insert into app.crm_visit_facts(
        run_id,
        purpose,
        target_date,
        cliniccards_visit_id,
        cliniccards_patient_id,
        source_status,
        remindable,
        target_at,
        appointment_fingerprint,
        fetched_at
      )
      values
        (
          old_run_id,
          'visits_initial',
          '2026-07-09',
          'visit-vanished-rpc',
          'patient-vanished-rpc',
          'PLANNED',
          true,
          '2026-07-09 10:00:00+00',
          'fingerprint-vanished-rpc',
          '2026-06-30 08:00:00+00'
        ),
        (
          current_run_id,
          'catchup',
          '2026-07-09',
          'visit-current-rpc',
          'patient-current-rpc',
          'PLANNED',
          true,
          '2026-07-09 11:00:00+00',
          'fingerprint-current-rpc',
          '2026-06-30 09:00:00+00'
        ),
        (
          current_run_id,
          'catchup',
          '2026-07-10',
          'visit-moved-rpc',
          'patient-moved-rpc',
          'PLANNED',
          true,
          '2026-07-10 12:00:00+00',
          'fingerprint-moved-rpc',
          '2026-06-30 09:00:00+00'
        );

      insert into app.reminder_messages(
        run_id,
        cliniccards_visit_id,
        target_date,
        target_at,
        message_kind,
        appointment_fingerprint,
        source_status,
        status,
        send_attempt_count,
        tracking_token_digest,
        token_expires_at,
        action_taken,
        crm_writeback_ok,
        response,
        responded_at,
        action_locked_at
      )
      values
        (
          current_run_id,
          'visit-current-rpc',
          '2026-07-09',
          '2026-07-09 11:00:00+00',
          'initial_reminder',
          'fingerprint-current-rpc',
          'PLANNED',
          'sent',
          1,
          decode(repeat('3', 64), 'hex'),
          '2026-07-10 11:00:00+00',
          'none',
          null,
          null,
          null,
          null
        ),
        (
          old_run_id,
          'visit-vanished-rpc',
          '2026-07-09',
          '2026-07-09 10:00:00+00',
          'initial_reminder',
          'fingerprint-vanished-rpc',
          'PLANNED',
          'sent',
          1,
          decode(repeat('4', 64), 'hex'),
          '2026-07-10 10:00:00+00',
          'none',
          null,
          null,
          null,
          null
        ),
        (
          old_run_id,
          'visit-write-backed-rpc',
          '2026-07-09',
          '2026-07-09 12:00:00+00',
          'initial_reminder',
          'fingerprint-write-backed-rpc',
          'PLANNED',
          'sent',
          1,
          decode(repeat('5', 64), 'hex'),
          '2026-07-10 12:00:00+00',
          'cancelled',
          true,
          'cancel',
          '2026-06-30 08:05:00+00',
          '2026-06-30 08:05:00+00'
        ),
        (
          old_run_id,
          'visit-moved-rpc',
          '2026-07-09',
          '2026-07-09 12:00:00+00',
          'initial_reminder',
          'fingerprint-old-moved-rpc',
          'PLANNED',
          'sent',
          1,
          decode(repeat('6', 64), 'hex'),
          '2026-07-10 12:00:00+00',
          'none',
          null,
          null,
          null,
          null
        );
    end
    $setup$;
  $$,
  'setup vanished-visit reconciliation fixtures'
);

select lives_ok(
  $$
    set local role dentino_run_api;
    select api.run_reconcile_day(
      '2026-07-09'::date,
      '2026-06-30 09:00:07+00'::timestamptz
    );
    reset role;
  $$,
  'run_reconcile_day handles vanished sent rows through the DB store RPC'
);

select is(
  (
    select health || ':' || unaccounted_total::text || ':' || cliniccards_total::text
      from app.reminder_days
     where target_date = '2026-07-09'
  ),
  'red:1:1',
  'run_reconcile_day flags exactly the unresolved vanished sent visit red'
);

select lives_ok(
  $$
    set local role dentino_run_api;
    select api.run_finish_run(
      (
        select id
          from app.reminder_runs
         where target_date = '2026-07-08'
         order by id desc
         limit 1
      ),
      'completed',
      jsonb_build_object(
        'health', 'green',
        'remindableTotal', 1,
        'sentTotal', 1,
        'failedTotal', 0,
        'skippedTotal', 0
      ),
      '2026-06-30 09:00:08+00'::timestamptz
    );
    reset role;
  $$,
  'run API role finishes the reminder run through the DB store RPC'
);

select is(
  (
    select status || ':' || total::text || ':' || sent::text
      from app.reminder_runs
     where target_date = '2026-07-08'
     order by id desc
     limit 1
  ),
  'completed:1:1',
  'run_finish_run records completed run counters'
);

select ok(
  has_function_privilege('dentino_run_api', 'api.run_start_run(date,date,text,text,timestamptz)'::regprocedure, 'execute')
  and has_function_privilege('service_role', 'api.run_start_run(date,date,text,text,timestamptz)'::regprocedure, 'execute'),
  'dentino_run_api and service_role execute non-public run-store RPCs'
);

select ok(
  not has_function_privilege('dentino_confirm_api', 'api.run_start_run(date,date,text,text,timestamptz)'::regprocedure, 'execute'),
  'dentino_confirm_api cannot execute run-store RPCs'
);

select * from finish();

rollback;
