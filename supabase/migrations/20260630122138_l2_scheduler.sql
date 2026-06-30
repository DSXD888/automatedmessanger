-- L2 scheduler: Kyiv-gated multi-fire noon run + afternoon catch-up.
-- Source of truth: research section 4.4, section 5.7a, and ADR-006/012.

create extension if not exists pg_cron;
create extension if not exists pg_net;

do $$
begin
  if to_regclass('vault.decrypted_secrets') is not null then
    grant usage on schema vault to dentino_maintenance_definer;
    grant select on vault.decrypted_secrets to dentino_maintenance_definer;
  end if;
end;
$$;

create or replace function maintenance.invoke_run_reminders(
  p_pass_kind text,
  p_target_date date default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  app_env text := nullif(current_setting('app.env', true), '');
  endpoint text;
  bearer text;
  payload jsonb;
  request_id bigint;
begin
  if p_pass_kind not in ('initial', 'catchup') then
    raise exception 'Unsupported scheduled pass kind: %', p_pass_kind;
  end if;

  if app_env in ('test', 'ci', 'dev') then
    insert into app.audit_log(actor, action, detail)
    values (
      'pg_cron',
      'run_reminders_scheduler_skipped',
      jsonb_build_object(
        'reason', 'app_env_guard',
        'app_env', app_env,
        'pass_kind', p_pass_kind
      )
    );
    return null;
  end if;

  if to_regclass('vault.decrypted_secrets') is null then
    insert into app.audit_log(actor, action, detail)
    values (
      'pg_cron',
      'run_reminders_scheduler_skipped',
      jsonb_build_object(
        'reason', 'vault_unavailable',
        'pass_kind', p_pass_kind
      )
    );
    return null;
  end if;

  select decrypted_secret
    into endpoint
    from vault.decrypted_secrets
   where name = 'dentino_run_reminders_url';

  select decrypted_secret
    into bearer
    from vault.decrypted_secrets
   where name = 'dentino_run_reminders_bearer';

  if nullif(endpoint, '') is null or nullif(bearer, '') is null then
    insert into app.audit_log(actor, action, detail)
    values (
      'pg_cron',
      'run_reminders_scheduler_skipped',
      jsonb_build_object(
        'reason', 'missing_vault_secret',
        'pass_kind', p_pass_kind
      )
    );
    return null;
  end if;

  payload := jsonb_build_object(
    'trigger', 'cron',
    'pass_kind', p_pass_kind
  );

  if p_target_date is not null then
    payload := payload || jsonb_build_object('target_date', p_target_date::text);
  end if;

  select net.http_post(
    url := endpoint,
    headers := jsonb_build_object(
      'Content-type', 'application/json',
      'Authorization', 'Bearer ' || bearer
    ),
    body := payload
  )
    into request_id;

  return request_id;
end;
$$;

alter function maintenance.invoke_run_reminders(text, date)
  owner to dentino_maintenance_definer;
revoke all on function maintenance.invoke_run_reminders(text, date) from public;
grant execute on function maintenance.invoke_run_reminders(text, date)
  to dentino_maintenance_runner;

do $$
declare
  job_name text;
begin
  foreach job_name in array array[
    'dentino-run-reminders-noon-0900-utc',
    'dentino-run-reminders-noon-0930-utc',
    'dentino-run-reminders-noon-1000-utc',
    'dentino-run-reminders-noon-1030-utc',
    'dentino-run-reminders-catchup-1330-utc',
    'dentino-run-reminders-catchup-1430-utc'
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
  'dentino-run-reminders-noon-0900-utc',
  '0 9 * * *',
  $$select maintenance.invoke_run_reminders('initial');$$
);
select pg_temp.schedule_dentino_job(
  'dentino-run-reminders-noon-0930-utc',
  '30 9 * * *',
  $$select maintenance.invoke_run_reminders('initial');$$
);
select pg_temp.schedule_dentino_job(
  'dentino-run-reminders-noon-1000-utc',
  '0 10 * * *',
  $$select maintenance.invoke_run_reminders('initial');$$
);
select pg_temp.schedule_dentino_job(
  'dentino-run-reminders-noon-1030-utc',
  '30 10 * * *',
  $$select maintenance.invoke_run_reminders('initial');$$
);
select pg_temp.schedule_dentino_job(
  'dentino-run-reminders-catchup-1330-utc',
  '30 13 * * *',
  $$select maintenance.invoke_run_reminders('catchup');$$
);
select pg_temp.schedule_dentino_job(
  'dentino-run-reminders-catchup-1430-utc',
  '30 14 * * *',
  $$select maintenance.invoke_run_reminders('catchup');$$
);
