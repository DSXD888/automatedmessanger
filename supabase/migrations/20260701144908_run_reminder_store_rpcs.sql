-- Run-reminders DB store RPCs.
-- Source of truth: spec FR-L1-RUN-02/03, FR-L2-RUN-06/07 and ADR-012/020/023.

grant usage on schema api to dentino_run_api;
grant update on app.crm_visit_facts to dentino_run_api;

create or replace function api.run_start_run(
  p_run_date date,
  p_target_date date,
  p_trigger text,
  p_pass_kind text,
  p_now timestamptz
)
returns table (
  id bigint,
  run_date date,
  target_date date,
  trigger text,
  pass_kind text,
  status text,
  started_at timestamptz,
  finished_at timestamptz
)
language plpgsql
set search_path = ''
as $$
begin
  return query
  insert into app.reminder_runs(run_date, target_date, trigger, pass_kind, status, started_at)
  values (p_run_date, p_target_date, p_trigger, p_pass_kind, 'running', p_now)
  returning
    app.reminder_runs.id,
    app.reminder_runs.run_date,
    app.reminder_runs.target_date,
    app.reminder_runs.trigger,
    app.reminder_runs.pass_kind,
    app.reminder_runs.status,
    app.reminder_runs.started_at,
    app.reminder_runs.finished_at;
end;
$$;

create or replace function api.run_claim_day(
  p_target_date date,
  p_run_id bigint,
  p_pass_kind text,
  p_lock_token uuid,
  p_now timestamptz
)
returns table (
  claimed boolean,
  reason text,
  stole_existing_lease boolean
)
language plpgsql
set search_path = ''
as $$
declare
  existing app.reminder_days%rowtype;
  live_existing boolean := false;
  stole boolean := false;
begin
  select *
    into existing
    from app.reminder_days
   where target_date = p_target_date
   for update;

  if found then
    live_existing := existing.status = 'running'
      and (
        (existing.lock_heartbeat_at is not null and p_now - existing.lock_heartbeat_at <= interval '120 seconds')
        or (existing.lock_heartbeat_at is null and existing.lock_expires_at > p_now)
      );

    if live_existing then
      return query select false, 'live_lease'::text, false;
      return;
    end if;

    if existing.status = 'completed' and p_pass_kind = 'initial' then
      return query select false, 'completed_initial'::text, false;
      return;
    end if;

    stole := existing.status = 'running';
  end if;

  insert into app.reminder_days(
    target_date,
    status,
    locked_by_run_id,
    lock_token,
    lock_started_at,
    lock_heartbeat_at,
    lock_expires_at,
    updated_at
  )
  values (
    p_target_date,
    'running',
    p_run_id,
    p_lock_token,
    p_now,
    p_now,
    p_now + interval '15 minutes',
    p_now
  )
  on conflict (target_date) do update
     set status = 'running',
         locked_by_run_id = excluded.locked_by_run_id,
         lock_token = excluded.lock_token,
         lock_started_at = excluded.lock_started_at,
         lock_heartbeat_at = excluded.lock_heartbeat_at,
         lock_expires_at = excluded.lock_expires_at,
         updated_at = excluded.updated_at;

  return query select true, null::text, stole;
end;
$$;

create or replace function api.run_renew_day_heartbeat(
  p_target_date date,
  p_run_id bigint,
  p_lock_token uuid,
  p_now timestamptz
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  updated_count integer;
begin
  update app.reminder_days
     set lock_heartbeat_at = p_now,
         lock_expires_at = p_now + interval '15 minutes',
         updated_at = p_now
   where target_date = p_target_date
     and status = 'running'
     and locked_by_run_id = p_run_id
     and lock_token = p_lock_token;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function api.run_record_visit_facts(
  p_run_id bigint,
  p_facts jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  inserted_count integer;
begin
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
  select
    p_run_id,
    fact.purpose,
    fact.target_date,
    fact.cliniccards_visit_id,
    fact.cliniccards_patient_id,
    fact.source_status,
    fact.remindable,
    fact.target_at,
    fact.appointment_fingerprint,
    fact.fetched_at
  from jsonb_to_recordset(coalesce(p_facts, '[]'::jsonb)) as fact(
    purpose text,
    target_date date,
    cliniccards_visit_id text,
    cliniccards_patient_id text,
    source_status text,
    remindable boolean,
    target_at timestamptz,
    appointment_fingerprint text,
    fetched_at timestamptz
  )
  on conflict (run_id, cliniccards_visit_id, purpose) do update
     set target_date = excluded.target_date,
         cliniccards_patient_id = excluded.cliniccards_patient_id,
         source_status = excluded.source_status,
         remindable = excluded.remindable,
         target_at = excluded.target_at,
         appointment_fingerprint = excluded.appointment_fingerprint,
         fetched_at = excluded.fetched_at;

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function api.run_record_fetch_logs(
  p_run_id bigint,
  p_logs jsonb
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  inserted_count integer;
begin
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
  select
    p_run_id,
    log_row.purpose,
    log_row.method,
    log_row.path,
    coalesce(log_row.request_params, '{}'::jsonb),
    log_row.response_status,
    log_row.raw_redacted,
    case
      when nullif(log_row.raw_sha256_hex, '') is null then null
      else decode(log_row.raw_sha256_hex, 'hex')
    end,
    log_row.fetched_at
  from jsonb_to_recordset(coalesce(p_logs, '[]'::jsonb)) as log_row(
    purpose text,
    method text,
    path text,
    request_params jsonb,
    response_status integer,
    raw_redacted jsonb,
    raw_sha256_hex text,
    fetched_at timestamptz
  );

  get diagnostics inserted_count = row_count;
  return inserted_count;
end;
$$;

create or replace function api.run_materialize_message(
  p_run_id bigint,
  p_cliniccards_visit_id text,
  p_cliniccards_patient_id text,
  p_target_date date,
  p_target_at timestamptz,
  p_message_kind text,
  p_appointment_fingerprint text,
  p_source_status text,
  p_status text,
  p_skip_reason text,
  p_patient_display_snapshot text,
  p_now timestamptz
)
returns table (
  id bigint,
  run_id bigint,
  cliniccards_visit_id text,
  cliniccards_patient_id text,
  target_date date,
  target_at timestamptz,
  channel text,
  message_kind text,
  appointment_fingerprint text,
  source_status text,
  status text,
  skip_reason text,
  patient_id bigint,
  patient_display_snapshot text,
  send_claim_token uuid,
  send_claim_expires_at timestamptz,
  send_attempt_count integer,
  last_attempt_at timestamptz,
  provider_message_id text,
  tracking_token_digest_hex text,
  token_expires_at timestamptz,
  superseded_at timestamptz,
  superseded_by_message_id bigint,
  error text,
  action_taken text,
  crm_writeback_ok boolean
)
language plpgsql
set search_path = ''
as $$
declare
  active_message app.reminder_messages%rowtype;
  created_message app.reminder_messages%rowtype;
  resolved_patient_id bigint;
  resolved_message_kind text := p_message_kind;
begin
  select *
    into active_message
    from app.reminder_messages candidate
   where candidate.cliniccards_visit_id = p_cliniccards_visit_id
     and candidate.target_date = p_target_date
     and candidate.status <> 'superseded'
     and candidate.message_kind in ('initial_reminder', 'catchup_reminder', 'time_change_notice')
   order by candidate.id desc
   limit 1
   for update;

  if found and active_message.appointment_fingerprint = p_appointment_fingerprint then
    return query
      select * from api.run_messages_for_target_date(p_target_date) existing
       where existing.id = active_message.id;
    return;
  end if;

  if found then
    update app.reminder_messages
       set status = 'superseded',
           superseded_at = p_now,
           token_expires_at = p_now
     where app.reminder_messages.id = active_message.id;
    resolved_message_kind := 'time_change_notice';
  end if;

  if nullif(p_cliniccards_patient_id, '') is not null then
    insert into app.patients(cliniccards_id, created_at, updated_at)
    values (p_cliniccards_patient_id, p_now, p_now)
    on conflict (cliniccards_id) do update
       set updated_at = excluded.updated_at
    returning app.patients.id
      into resolved_patient_id;
  end if;

  insert into app.reminder_messages(
    run_id,
    cliniccards_visit_id,
    patient_id,
    target_date,
    target_at,
    channel,
    message_kind,
    appointment_fingerprint,
    source_status,
    status,
    skip_reason,
    patient_display_snapshot,
    action_taken,
    created_at
  )
  values (
    p_run_id,
    p_cliniccards_visit_id,
    resolved_patient_id,
    p_target_date,
    p_target_at,
    'sms',
    resolved_message_kind,
    p_appointment_fingerprint,
    p_source_status,
    p_status,
    p_skip_reason,
    p_patient_display_snapshot,
    'none',
    p_now
  )
  returning *
    into created_message;

  if found and active_message.id is not null then
    update app.reminder_messages
       set superseded_by_message_id = created_message.id
     where app.reminder_messages.id = active_message.id;
  end if;

  return query
    select * from api.run_messages_for_target_date(p_target_date) created
     where created.id = created_message.id;
end;
$$;

create or replace function api.run_claim_message_for_send(
  p_message_id bigint,
  p_claim_token uuid,
  p_token_digest_hex text,
  p_token_expires_at timestamptz,
  p_claim_expires_at timestamptz,
  p_now timestamptz
)
returns table (
  id bigint,
  run_id bigint,
  cliniccards_visit_id text,
  cliniccards_patient_id text,
  target_date date,
  target_at timestamptz,
  channel text,
  message_kind text,
  appointment_fingerprint text,
  source_status text,
  status text,
  skip_reason text,
  patient_id bigint,
  patient_display_snapshot text,
  send_claim_token uuid,
  send_claim_expires_at timestamptz,
  send_attempt_count integer,
  last_attempt_at timestamptz,
  provider_message_id text,
  tracking_token_digest_hex text,
  token_expires_at timestamptz,
  superseded_at timestamptz,
  superseded_by_message_id bigint,
  error text,
  action_taken text,
  crm_writeback_ok boolean
)
language plpgsql
set search_path = ''
as $$
declare
  claimed_id bigint;
  claimed_target_date date;
begin
  update app.reminder_messages as message
     set status = 'sending',
         send_claim_token = p_claim_token,
         send_claim_expires_at = p_claim_expires_at,
         tracking_token_digest = decode(p_token_digest_hex, 'hex'),
         token_expires_at = p_token_expires_at,
         send_attempt_count = message.send_attempt_count + 1,
         last_attempt_at = p_now
   where message.id in (
     select candidate.id
      from app.reminder_messages candidate
      where candidate.id = p_message_id
        and (
          (
            candidate.status = 'pending'
            and candidate.tracking_token_digest is null
          )
          or (
            candidate.status = 'failed'
            and candidate.skip_reason = 'provider_pre_submit_failure'
          )
        )
      for update skip locked
   )
  returning message.id, message.target_date
    into claimed_id, claimed_target_date;

  if claimed_id is null then
    return;
  end if;

  return query
    select * from api.run_messages_for_target_date(claimed_target_date) claimed
     where claimed.id = claimed_id;
end;
$$;

create or replace function api.run_commit_send_outcome(
  p_message_id bigint,
  p_claim_token uuid,
  p_status text,
  p_skip_reason text,
  p_provider_message_id text,
  p_error text,
  p_now timestamptz
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  updated_count integer;
begin
  update app.reminder_messages
     set status = p_status,
         skip_reason = p_skip_reason,
         error = p_error,
         provider_message_id = p_provider_message_id,
         send_claim_token = null,
         send_claim_expires_at = null,
         last_attempt_at = p_now
   where id = p_message_id
     and status = 'sending'
     and send_claim_token = p_claim_token;

  get diagnostics updated_count = row_count;
  return updated_count = 1;
end;
$$;

create or replace function api.run_mark_message_skipped(
  p_message_id bigint,
  p_reason text,
  p_error text default null
)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update app.reminder_messages
     set status = 'skipped',
         skip_reason = p_reason,
         error = p_error
   where id = p_message_id
     and status <> 'superseded';
end;
$$;

create or replace function api.run_reap_expired_send_claims(
  p_target_date date,
  p_now timestamptz
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  reaped_count integer;
begin
  update app.reminder_messages
     set status = 'send_unknown',
         skip_reason = 'send_ambiguous',
         error = 'stale send claim reaped',
         send_claim_token = null,
         send_claim_expires_at = null
   where target_date = p_target_date
     and status = 'sending'
     and send_claim_expires_at < p_now;

  get diagnostics reaped_count = row_count;
  return reaped_count;
end;
$$;

create or replace function api.run_reap_orphaned_send_claims(
  p_target_date date,
  p_now timestamptz
)
returns integer
language plpgsql
set search_path = ''
as $$
declare
  reaped_count integer;
begin
  update app.reminder_messages
     set status = 'send_unknown',
         skip_reason = 'send_ambiguous',
         error = 'orphaned send claim reaped after day lease steal',
         send_claim_token = null,
         send_claim_expires_at = null,
         last_attempt_at = p_now
   where target_date = p_target_date
     and status = 'sending';

  get diagnostics reaped_count = row_count;
  return reaped_count;
end;
$$;

create or replace function api.run_pending_writebacks()
returns table (
  message_id bigint,
  cliniccards_visit_id text,
  action text,
  expected_appointment_fingerprint text,
  crm_writeback_ok boolean,
  superseded_at timestamptz
)
language sql
stable
set search_path = ''
as $$
  select
    m.id as message_id,
    m.cliniccards_visit_id,
    case m.action_taken
      when 'confirmed' then 'confirm'
      when 'cancelled' then 'cancel'
    end as action,
    m.appointment_fingerprint as expected_appointment_fingerprint,
    m.crm_writeback_ok,
    m.superseded_at
  from app.reminder_messages m
  where m.action_taken in ('confirmed', 'cancelled')
    and m.crm_writeback_ok is not true
    and m.superseded_at is null
  order by m.responded_at nulls first, m.id;
$$;

create or replace function api.run_finish_writeback(
  p_message_id bigint,
  p_ok boolean,
  p_error text default null
)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  updated_count integer;
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

  delete from app.crm_visit_write_locks
   where locked_by_message_id = p_message_id;

  return updated_count = 1;
end;
$$;

create or replace function api.run_reconcile_day(
  p_target_date date,
  p_now timestamptz
)
returns table (
  target_date date,
  cliniccards_total integer,
  remindable_total integer,
  sendable_total integer,
  sent_total integer,
  skipped_total integer,
  failed_total integer,
  send_unknown_total integer,
  pending_total integer,
  writeback_pending_total integer,
  unaccounted_total integer,
  health text
)
language plpgsql
set search_path = ''
as $$
#variable_conflict use_column
declare
  computed record;
begin
  with latest_observation_run as (
    select run.id as run_id
      from app.reminder_runs run
     where run.target_date = p_target_date
       and exists (
         select 1
           from app.crm_fetch_log fetch_log
          where fetch_log.run_id = run.id
            and fetch_log.purpose in ('visits_initial', 'catchup')
            and fetch_log.response_status between 200 and 299
       )
     order by (
       select max(fetch_log.fetched_at)
         from app.crm_fetch_log fetch_log
        where fetch_log.run_id = run.id
          and fetch_log.purpose in ('visits_initial', 'catchup')
          and fetch_log.response_status between 200 and 299
     ) desc,
     run.id desc
     limit 1
  ),
  latest_fact_run as (
    select fact.run_id
      from app.crm_visit_facts fact
     where fact.target_date = p_target_date
     order by fact.fetched_at desc, fact.run_id desc
     limit 1
  ),
  current_run as (
    select run_id from latest_observation_run
    union all
    select run_id from latest_fact_run
     where not exists (select 1 from latest_observation_run)
    limit 1
  ),
  current_facts as (
    select fact.*
      from app.crm_visit_facts fact
     where fact.target_date = p_target_date
       and fact.run_id = (select run_id from current_run)
  ),
  active_messages as (
    select *
      from app.reminder_messages message
     where message.target_date = p_target_date
       and message.status <> 'superseded'
  ),
  current_unaccounted as (
    select count(*)::integer as total
      from current_facts fact
     where fact.remindable is true
       and not exists (
         select 1
           from active_messages message
          where message.cliniccards_visit_id = fact.cliniccards_visit_id
            and message.appointment_fingerprint = fact.appointment_fingerprint
       )
  ),
  vanished_unaccounted as (
    select count(*)::integer as total
      from active_messages message
     where message.status in ('sent', 'delivered')
       and not exists (
         select 1
           from current_facts fact
          where fact.cliniccards_visit_id = message.cliniccards_visit_id
       )
       and not (
         message.action_taken in ('confirmed', 'cancelled')
         and message.crm_writeback_ok is true
       )
       and not exists (
         select 1
           from app.crm_visit_facts moved_fact
          where moved_fact.cliniccards_visit_id = message.cliniccards_visit_id
            and moved_fact.target_date <> message.target_date
            and moved_fact.run_id >= message.run_id
       )
       and not exists (
         select 1
           from app.crm_visit_facts terminal_fact
           join app.cliniccards_status_policy policy
             on policy.status = terminal_fact.source_status
          where terminal_fact.cliniccards_visit_id = message.cliniccards_visit_id
            and terminal_fact.target_date = message.target_date
            and terminal_fact.run_id >= message.run_id
            and policy.terminal is true
       )
  ),
  counts as (
    select
      p_target_date as target_date,
      (select count(*)::integer from current_facts) as cliniccards_total,
      (select count(*)::integer from current_facts where remindable is true) as remindable_total,
      (select count(*)::integer from active_messages where skip_reason is null) as sendable_total,
      (select count(*)::integer from active_messages where status in ('sent', 'delivered')) as sent_total,
      (select count(*)::integer from active_messages where status = 'skipped') as skipped_total,
      (select count(*)::integer from active_messages where status = 'failed') as failed_total,
      (select count(*)::integer from active_messages where status = 'send_unknown') as send_unknown_total,
      (select count(*)::integer from active_messages where status in ('pending', 'sending')) as pending_total,
      (
        select count(*)::integer
          from active_messages
         where action_taken in ('confirmed', 'cancelled')
           and crm_writeback_ok is not true
           and superseded_at is null
      ) as writeback_pending_total,
      (
        (select total from current_unaccounted)
        + (select total from vanished_unaccounted)
      ) as unaccounted_total
  )
  select
    counts.*,
    case
      when counts.unaccounted_total > 0
        or counts.pending_total > 0
        or counts.failed_total > 0
        or counts.send_unknown_total > 0
        or counts.writeback_pending_total > 0 then 'red'
      when counts.skipped_total > 0 then 'amber'
      else 'green'
    end as computed_health
    into computed
    from counts;

  insert into app.reminder_days(target_date, status, updated_at)
  values (p_target_date, 'idle', p_now)
  on conflict (target_date) do nothing;

  update app.reminder_days
     set cliniccards_total = computed.cliniccards_total,
         remindable_total = computed.remindable_total,
         sendable_total = computed.sendable_total,
         sent_total = computed.sent_total,
         skipped_total = computed.skipped_total,
         failed_total = computed.failed_total,
         send_unknown_total = computed.send_unknown_total,
         pending_total = computed.pending_total,
         unaccounted_total = computed.unaccounted_total,
         health = computed.computed_health,
         reconciled_at = p_now,
         updated_at = p_now,
         status = case
           when computed.computed_health = 'green' then 'completed'
           else 'partial'
         end
   where app.reminder_days.target_date = p_target_date;

  return query select
    computed.target_date,
    computed.cliniccards_total,
    computed.remindable_total,
    computed.sendable_total,
    computed.sent_total,
    computed.skipped_total,
    computed.failed_total,
    computed.send_unknown_total,
    computed.pending_total,
    computed.writeback_pending_total,
    computed.unaccounted_total,
    computed.computed_health;
end;
$$;

create or replace function api.run_finish_run(
  p_run_id bigint,
  p_status text,
  p_reconciliation jsonb,
  p_now timestamptz
)
returns table (
  id bigint,
  run_date date,
  target_date date,
  trigger text,
  pass_kind text,
  status text,
  started_at timestamptz,
  finished_at timestamptz
)
language plpgsql
set search_path = ''
as $$
declare
  run_target_date date;
  reconciliation_health text := p_reconciliation->>'health';
begin
  update app.reminder_runs
     set status = p_status,
         finished_at = p_now,
         total = coalesce((p_reconciliation->>'remindableTotal')::integer, total),
         sent = coalesce((p_reconciliation->>'sentTotal')::integer, sent),
         failed = coalesce((p_reconciliation->>'failedTotal')::integer, failed),
         skipped = coalesce((p_reconciliation->>'skippedTotal')::integer, skipped)
   where app.reminder_runs.id = p_run_id
  returning app.reminder_runs.target_date
    into run_target_date;

  if run_target_date is null then
    raise exception 'Unknown reminder run id %', p_run_id using errcode = '22023';
  end if;

  if p_reconciliation is not null then
    update app.reminder_days
       set health = reconciliation_health,
           status = case
             when reconciliation_health = 'green' then 'completed'
             when p_status = 'failed' then 'failed'
             else 'partial'
           end,
           updated_at = p_now
     where app.reminder_days.target_date = run_target_date;
  elsif p_status = 'failed' then
    update app.reminder_days
       set status = 'failed',
           updated_at = p_now
     where app.reminder_days.target_date = run_target_date;
  end if;

  return query
    select
      r.id,
      r.run_date,
      r.target_date,
      r.trigger,
      r.pass_kind,
      r.status,
      r.started_at,
      r.finished_at
    from app.reminder_runs r
    where r.id = p_run_id;
end;
$$;

create or replace function api.run_messages_for_target_date(p_target_date date)
returns table (
  id bigint,
  run_id bigint,
  cliniccards_visit_id text,
  cliniccards_patient_id text,
  target_date date,
  target_at timestamptz,
  channel text,
  message_kind text,
  appointment_fingerprint text,
  source_status text,
  status text,
  skip_reason text,
  patient_id bigint,
  patient_display_snapshot text,
  send_claim_token uuid,
  send_claim_expires_at timestamptz,
  send_attempt_count integer,
  last_attempt_at timestamptz,
  provider_message_id text,
  tracking_token_digest_hex text,
  token_expires_at timestamptz,
  superseded_at timestamptz,
  superseded_by_message_id bigint,
  error text,
  action_taken text,
  crm_writeback_ok boolean
)
language sql
stable
set search_path = ''
as $$
  select
    m.id,
    m.run_id,
    m.cliniccards_visit_id,
    p.cliniccards_id as cliniccards_patient_id,
    m.target_date,
    m.target_at,
    m.channel,
    m.message_kind,
    m.appointment_fingerprint,
    m.source_status,
    m.status,
    m.skip_reason,
    m.patient_id,
    m.patient_display_snapshot,
    m.send_claim_token,
    m.send_claim_expires_at,
    m.send_attempt_count,
    m.last_attempt_at,
    m.provider_message_id,
    case
      when m.tracking_token_digest is null then null
      else encode(m.tracking_token_digest, 'hex')
    end as tracking_token_digest_hex,
    m.token_expires_at,
    m.superseded_at,
    m.superseded_by_message_id,
    m.error,
    m.action_taken,
    m.crm_writeback_ok
  from app.reminder_messages m
  left join app.patients p on p.id = m.patient_id
  where m.target_date = p_target_date
  order by m.id;
$$;

create or replace function api.run_cliniccards_status_policy()
returns table (
  status text,
  remindable boolean,
  terminal boolean,
  allow_confirm_action boolean,
  allow_cancel_action boolean,
  send_change_notice boolean
)
language sql
stable
set search_path = ''
as $$
  select
    p.status,
    p.remindable,
    p.terminal,
    p.allow_confirm_action,
    p.allow_cancel_action,
    p.send_change_notice
  from app.cliniccards_status_policy p
  order by p.status;
$$;

revoke execute on function api.run_start_run(date, date, text, text, timestamptz)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_claim_day(date, bigint, text, uuid, timestamptz)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_renew_day_heartbeat(date, bigint, uuid, timestamptz)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_record_visit_facts(bigint, jsonb)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_record_fetch_logs(bigint, jsonb)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_materialize_message(bigint, text, text, date, timestamptz, text, text, text, text, text, text, timestamptz)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_claim_message_for_send(bigint, uuid, text, timestamptz, timestamptz, timestamptz)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_commit_send_outcome(bigint, uuid, text, text, text, text, timestamptz)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_mark_message_skipped(bigint, text, text)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_reap_expired_send_claims(date, timestamptz)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_reap_orphaned_send_claims(date, timestamptz)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_pending_writebacks()
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_finish_writeback(bigint, boolean, text)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_reconcile_day(date, timestamptz)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_finish_run(bigint, text, jsonb, timestamptz)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_messages_for_target_date(date)
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;
revoke execute on function api.run_cliniccards_status_policy()
  from public, anon, authenticated, dentino_confirm_api, dentino_maintenance_runner;

grant execute on function api.run_start_run(date, date, text, text, timestamptz) to dentino_run_api, service_role;
grant execute on function api.run_claim_day(date, bigint, text, uuid, timestamptz) to dentino_run_api, service_role;
grant execute on function api.run_renew_day_heartbeat(date, bigint, uuid, timestamptz) to dentino_run_api, service_role;
grant execute on function api.run_record_visit_facts(bigint, jsonb) to dentino_run_api, service_role;
grant execute on function api.run_record_fetch_logs(bigint, jsonb) to dentino_run_api, service_role;
grant execute on function api.run_materialize_message(bigint, text, text, date, timestamptz, text, text, text, text, text, text, timestamptz) to dentino_run_api, service_role;
grant execute on function api.run_claim_message_for_send(bigint, uuid, text, timestamptz, timestamptz, timestamptz) to dentino_run_api, service_role;
grant execute on function api.run_commit_send_outcome(bigint, uuid, text, text, text, text, timestamptz) to dentino_run_api, service_role;
grant execute on function api.run_mark_message_skipped(bigint, text, text) to dentino_run_api, service_role;
grant execute on function api.run_reap_expired_send_claims(date, timestamptz) to dentino_run_api, service_role;
grant execute on function api.run_reap_orphaned_send_claims(date, timestamptz) to dentino_run_api, service_role;
grant execute on function api.run_pending_writebacks() to dentino_run_api, service_role;
grant execute on function api.run_finish_writeback(bigint, boolean, text) to dentino_run_api, service_role;
grant execute on function api.run_reconcile_day(date, timestamptz) to dentino_run_api, service_role;
grant execute on function api.run_finish_run(bigint, text, jsonb, timestamptz) to dentino_run_api, service_role;
grant execute on function api.run_messages_for_target_date(date) to dentino_run_api, service_role;
grant execute on function api.run_cliniccards_status_policy() to dentino_run_api, service_role;
