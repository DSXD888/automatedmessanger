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
