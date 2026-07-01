begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
select set_config('app.env', 'test', false);
select set_config('app.test_now', '2026-06-30 09:00:00+00', false);

do $$
begin
  execute format('grant dentino_run_api to %I', current_user);
end;
$$;

select plan(40);

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

create or replace function pg_temp.record_action_cas(
  p_message_id bigint,
  p_action text
)
returns int
language plpgsql
as $$
declare
  updated_count int;
begin
  update app.reminder_messages
     set response = p_action,
         responded_at = app.now(),
         action_locked_at = app.now(),
         action_taken = case
           when p_action = 'confirm' then 'confirmed'
           else 'cancelled'
         end
   where id = p_message_id
     and action_locked_at is null
     and response is null
     and status in ('sent', 'delivered', 'send_unknown')
     and token_expires_at > app.now()
     and superseded_at is null;

  get diagnostics updated_count = row_count;
  return updated_count;
end;
$$;

create or replace function pg_temp.claim_write_lock(
  p_visit_id text,
  p_message_id bigint,
  p_token uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
as $$
declare
  claimed boolean;
begin
  insert into app.crm_visit_write_locks(
    cliniccards_visit_id,
    lock_token,
    locked_by_message_id,
    locked_at,
    lock_expires_at
  )
  values (
    p_visit_id,
    p_token,
    p_message_id,
    p_now,
    p_now + interval '90 seconds'
  )
  on conflict (cliniccards_visit_id) do update
  set lock_token = excluded.lock_token,
      locked_by_message_id = excluded.locked_by_message_id,
      locked_at = excluded.locked_at,
      lock_expires_at = excluded.lock_expires_at
  where app.crm_visit_write_locks.lock_expires_at <= p_now
  returning true into claimed;

  return coalesce(claimed, false);
end;
$$;

create or replace function pg_temp.release_write_lock(
  p_visit_id text,
  p_token uuid
)
returns int
language plpgsql
as $$
declare
  deleted_count int;
begin
  delete from app.crm_visit_write_locks
  where cliniccards_visit_id = p_visit_id
    and lock_token = p_token;
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

create or replace function pg_temp.write_lock_fixture()
returns table(
  visit_id text,
  first_message_id bigint,
  second_message_id bigint,
  first_token uuid,
  second_token uuid
)
language plpgsql
as $$
declare
  run_id bigint;
  fixture_visit_id text := 'visit-write-lock-' || extensions.gen_random_uuid()::text;
begin
  insert into app.reminder_runs(run_date, target_date, trigger)
  values ('2026-06-30', '2026-07-01', 'manual')
  returning id into run_id;

  insert into app.reminder_messages(
    run_id,
    cliniccards_visit_id,
    target_date,
    target_at,
    message_kind
  )
  values (
    run_id,
    fixture_visit_id,
    '2026-07-01',
    '2026-07-01 09:00+00',
    'initial_reminder'
  )
  returning id into first_message_id;

  insert into app.reminder_messages(
    run_id,
    cliniccards_visit_id,
    target_date,
    target_at,
    message_kind,
    appointment_fingerprint
  )
  values (
    run_id,
    fixture_visit_id,
    '2026-07-01',
    '2026-07-01 09:00+00',
    'time_change_notice',
    'second-contender'
  )
  returning id into second_message_id;

  visit_id := fixture_visit_id;
  first_token := extensions.gen_random_uuid();
  second_token := extensions.gen_random_uuid();
  return next;
end;
$$;

create temp table write_lock_case as
select * from pg_temp.write_lock_fixture();

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

create temp table action_cas_case(message_id bigint not null);

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
    'sent',
    extensions.gen_random_bytes(32),
    app.now() + interval '1 day'
  from run
  returning id
)
insert into action_cas_case(message_id)
select id from message;

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
  pg_temp.record_action_cas(
    (select message_id from action_cas_case),
    'confirm'
  ),
  1,
  'first action CAS consumes exactly one action lock'
);

select is(
  pg_temp.record_action_cas(
    (select message_id from action_cas_case),
    'cancel'
  ),
  0,
  'second action CAS affects zero rows'
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

select ok(
  pg_temp.claim_write_lock(
    (select visit_id from write_lock_case),
    (select first_message_id from write_lock_case),
    (select first_token from write_lock_case),
    app.now()
  ),
  'first write-lock contender claims the visit lease'
);

select ok(
  not pg_temp.claim_write_lock(
    (select visit_id from write_lock_case),
    (select second_message_id from write_lock_case),
    (select second_token from write_lock_case),
    app.now() + interval '1 second'
  ),
  'second live write-lock contender does not win'
);

select ok(
  pg_temp.claim_write_lock(
    (select visit_id from write_lock_case),
    (select second_message_id from write_lock_case),
    (select second_token from write_lock_case),
    app.now() + interval '91 seconds'
  ),
  'stale write-lock lease is stealable after expiry'
);

select is(
  pg_temp.release_write_lock(
    (select visit_id from write_lock_case),
    (select first_token from write_lock_case)
  ),
  0,
  'stale owner token cannot release the stealer lease'
);

select is(
  pg_temp.release_write_lock(
    (select visit_id from write_lock_case),
    (select second_token from write_lock_case)
  ),
  1,
  'current owner token releases exactly one write-lock lease'
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
