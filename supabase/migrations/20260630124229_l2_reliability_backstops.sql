-- L2 reliability backstops: state-machine totality and CRM-write reaper sweep.
-- Source of truth: research section 5.7b, section 6.3.3, ADR-018, ADR-020.

create extension if not exists pg_cron;

do $$
declare
  job_name text;
begin
  foreach job_name in array array[
    'dentino-reap-stale-sends-every-5m',
    'dentino-writeback-reaper-sweep-every-15m'
  ]
  loop
    if exists (select 1 from cron.job where jobname = job_name) then
      perform cron.unschedule(job_name);
    end if;
  end loop;
end;
$$;

create or replace function pg_temp.schedule_dentino_job(
  p_job_name text,
  p_schedule text,
  p_command text
)
returns void
language plpgsql
as $$
begin
  if to_regprocedure('cron.schedule_in_database(text,text,text,text,text)') is not null then
    execute
      'select cron.schedule_in_database($1, $2, $3, current_database(), $4)'
      using p_job_name, p_schedule, p_command, 'dentino_maintenance_runner';
  else
    execute 'select cron.schedule($1, $2, $3)'
      using p_job_name, p_schedule, p_command;
  end if;
end;
$$;

select pg_temp.schedule_dentino_job(
  'dentino-reap-stale-sends-every-5m',
  '*/5 * * * *',
  $$select maintenance.reap_stale_sends();$$
);

select pg_temp.schedule_dentino_job(
  'dentino-writeback-reaper-sweep-every-15m',
  '*/15 * * * *',
  $$select maintenance.invoke_run_reminders('catchup');$$
);
