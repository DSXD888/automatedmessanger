-- L4 privacy retention: daily ADR-016 purge/anonymization backstop.
-- Source of truth: research section 4.5, section 6.3.3, and ADR-016.

create extension if not exists pg_cron;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'dentino-privacy-purge-daily') then
    perform cron.unschedule('dentino-privacy-purge-daily');
  end if;
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
  'dentino-privacy-purge-daily',
  '17 2 * * *',
  $$select maintenance.purge_privacy();$$
);
