begin;

create extension if not exists pgtap with schema extensions;
set search_path = extensions, public;
select set_config('app.env', 'test', false);
select set_config('app.test_now', '2026-06-30 09:00:00+00', false);

select plan(5);

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

select * from finish();

rollback;
