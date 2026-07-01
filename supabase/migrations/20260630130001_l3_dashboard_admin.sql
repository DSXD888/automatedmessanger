-- L3 dashboard staff surface: fixed projections plus audited admin RPCs.
-- Source of truth: research sections 5.2, 6.3.2 and ADR-011/017/019/024.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'dentino_dashboard_definer') then
    create role dentino_dashboard_definer noinherit nologin nobypassrls;
  end if;
end;
$$;

do $$
begin
  execute format('grant dentino_dashboard_definer to %I', current_user);
end;
$$;

grant usage on schema api to authenticated;
grant usage on schema api to dentino_dashboard_definer;
grant usage on schema app, private, extensions to dentino_dashboard_definer;
grant create on schema api, private to dentino_dashboard_definer;

grant select on app.reminder_runs to dentino_dashboard_definer;
grant select on app.reminder_days to dentino_dashboard_definer;
grant select, update on app.reminder_messages to dentino_dashboard_definer;
grant select, update on app.patients to dentino_dashboard_definer;
grant select, insert, update on app.message_templates to dentino_dashboard_definer;
grant select on app.crm_visit_facts to dentino_dashboard_definer;
grant insert, select on app.consent_events to dentino_dashboard_definer;
grant insert on app.audit_log to dentino_dashboard_definer;
grant usage, select on all sequences in schema app to dentino_dashboard_definer;

drop policy if exists reminder_runs_dashboard_definer_select on app.reminder_runs;
create policy reminder_runs_dashboard_definer_select on app.reminder_runs
  for select to dentino_dashboard_definer using (true);
drop policy if exists reminder_days_dashboard_definer_select on app.reminder_days;
create policy reminder_days_dashboard_definer_select on app.reminder_days
  for select to dentino_dashboard_definer using (true);
drop policy if exists reminder_messages_dashboard_definer_all on app.reminder_messages;
create policy reminder_messages_dashboard_definer_all on app.reminder_messages
  for all to dentino_dashboard_definer using (true) with check (true);
drop policy if exists patients_dashboard_definer_all on app.patients;
create policy patients_dashboard_definer_all on app.patients
  for all to dentino_dashboard_definer using (true) with check (true);
drop policy if exists message_templates_dashboard_definer_all on app.message_templates;
create policy message_templates_dashboard_definer_all on app.message_templates
  for all to dentino_dashboard_definer using (true) with check (true);
drop policy if exists crm_visit_facts_dashboard_definer_select on app.crm_visit_facts;
create policy crm_visit_facts_dashboard_definer_select on app.crm_visit_facts
  for select to dentino_dashboard_definer using (true);
drop policy if exists consent_events_dashboard_definer_insert on app.consent_events;
create policy consent_events_dashboard_definer_insert on app.consent_events
  for insert to dentino_dashboard_definer with check (true);
drop policy if exists consent_events_dashboard_definer_select on app.consent_events;
create policy consent_events_dashboard_definer_select on app.consent_events
  for select to dentino_dashboard_definer using (true);
drop policy if exists audit_log_dashboard_definer_insert on app.audit_log;
create policy audit_log_dashboard_definer_insert on app.audit_log
  for insert to dentino_dashboard_definer with check (true);

alter table app.reminder_messages
  add column if not exists staff_reason_tag text,
  add column if not exists staff_reason_tagged_at timestamptz,
  add column if not exists staff_reason_tagged_by text;

alter table app.reminder_messages
  drop constraint if exists reminder_messages_staff_reason_tag_check;

alter table app.reminder_messages
  add constraint reminder_messages_staff_reason_tag_check
  check (
    staff_reason_tag is null or staff_reason_tag in (
      'did_not_see_sms',
      'distrusts_link',
      'prefers_call',
      'could_not_reach'
    )
  );

create or replace function private.assert_sms_template_body(p_body text)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  template text := btrim(coalesce(p_body, ''));
  placeholders text[] := array[]::text[];
  placeholder text;
  required text;
  rendered text;
begin
  if template = '' then
    raise exception 'SMS template body is required' using errcode = '22023';
  end if;

  if template ~* '(diagnosis|diagnoses|clinical|procedure|treatment|prescription|medication|діагноз|клінічн|процедур|лікуван|рецепт|препарат|медикамент|payment|bank|banking|card|iban|cvv|pin|password|sms[-[:space:]]?code|one[-[:space:]]?time code|оплат|платіж|банк|карт|парол|смс[-[:space:]]?код|одноразовий код)' then
    raise exception 'SMS template must stay logistics-only' using errcode = '22023';
  end if;

  select coalesce(array_agg(distinct lower(found.placeholder[1])), array[]::text[])
    into placeholders
    from regexp_matches(template, '\{\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}\}', 'g') as found(placeholder);

  foreach placeholder in array placeholders loop
    if placeholder not in ('clinic', 'clinic_phone', 'confirm_url', 'date', 'name', 'time') then
      raise exception 'Unknown SMS placeholder: %', placeholder using errcode = '22023';
    end if;
  end loop;

  foreach required in array array['name', 'date', 'time', 'confirm_url', 'clinic_phone'] loop
    if not required = any(placeholders) then
      raise exception 'Missing SMS placeholder: %', required using errcode = '22023';
    end if;
  end loop;

  rendered := template;
  rendered := regexp_replace(rendered, '\{\{\s*name\s*\}\}', 'Олено', 'gi');
  rendered := regexp_replace(rendered, '\{\{\s*date\s*\}\}', '18.06', 'gi');
  rendered := regexp_replace(rendered, '\{\{\s*time\s*\}\}', '14:30', 'gi');
  rendered := regexp_replace(rendered, '\{\{\s*confirm_url\s*\}\}', 'https://r.dentino.com.ua/r/0123456789AbCdEfGhIjKl', 'gi');
  rendered := regexp_replace(rendered, '\{\{\s*clinic_phone\s*\}\}', '+380679876111', 'gi');
  rendered := regexp_replace(rendered, '\{\{\s*clinic\s*\}\}', 'Dentino', 'gi');

  if rendered ~ '\{\{' then
    raise exception 'SMS template contains unresolved placeholders' using errcode = '22023';
  end if;

  if char_length(rendered) > 134 then
    raise exception 'SMS template exceeds the two-segment UCS-2 budget' using errcode = '22023';
  end if;
end;
$$;

revoke all on function private.assert_sms_template_body(text) from public, anon, authenticated, dentino_confirm_api;
grant execute on function private.assert_sms_template_body(text) to dentino_dashboard_definer;

drop view if exists api.v_needs_attention;
drop view if exists api.v_board;
drop function if exists api.dashboard_needs_attention_rows();
drop function if exists api.dashboard_board_rows();

create or replace function api.dashboard_board_rows()
returns table (
  message_id bigint,
  target_date date,
  target_at timestamptz,
  target_time_kyiv text,
  cliniccards_visit_id text,
  patient_display text,
  patient_phone_last4 text,
  source_status text,
  send_state text,
  response_state text,
  staff_state text,
  staff_reason_tag text,
  staff_reason_tagged_at timestamptz,
  skip_reason text,
  action_taken text,
  crm_writeback_ok boolean,
  needs_attention boolean,
  latest_run_id bigint,
  latest_pass_kind text,
  latest_run_finished_at timestamptz,
  day_health text,
  cliniccards_total int,
  remindable_total int,
  sendable_total int,
  sent_total int,
  skipped_total int,
  failed_total int,
  send_unknown_total int,
  pending_total int,
  unaccounted_total int,
  success_heartbeat_sent boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    m.id as message_id,
    m.target_date,
    m.target_at,
    to_char(m.target_at at time zone 'Europe/Kyiv', 'HH24:MI') as target_time_kyiv,
    m.cliniccards_visit_id,
    coalesce(
      nullif(m.patient_display_snapshot, ''),
      nullif(trim(concat_ws(' ', p.first_name, left(coalesce(p.last_name, ''), 1))), ''),
      'Пацієнт ID ' || coalesce(p.cliniccards_id, m.cliniccards_visit_id)
    ) as patient_display,
    p.phone_last4 as patient_phone_last4,
    m.source_status,
    m.status as send_state,
    case
      when m.response = 'confirm' and m.action_taken = 'confirmed' and m.crm_writeback_ok is true then 'confirmed'
      when m.response = 'confirm' and m.action_taken in ('confirmed', 'error') then 'confirmed_writeback_attention'
      when m.response = 'cancel' and m.action_taken = 'cancelled' and m.crm_writeback_ok is true then 'cancelled'
      when m.response = 'cancel' and m.action_taken = 'pending_staff_review' then 'held_cancel'
      when m.response = 'cancel' and m.action_taken = 'staff_closed_no_write' then 'staff_closed_no_write'
      when m.response = 'cancel' and m.action_taken in ('cancelled', 'error') then 'cancelled_writeback_attention'
      when m.status = 'superseded' then 'superseded'
      when m.status = 'skipped' then 'skipped'
      when m.status in ('failed', 'send_unknown') then m.status
      else 'no_reply'
    end as response_state,
    case
      when lower(coalesce(m.error, '')) like '%not allowed under the current send_mode%'
        or lower(coalesce(m.error, '')) like '%not allowed under the current crm_write_mode%' then 'blocked_allowlist'
      when m.skip_reason = 'blocked_by_allowlist' then 'blocked_allowlist'
      when m.action_taken = 'pending_staff_review' then 'held_cancel'
      when m.action_taken = 'error'
        or (m.action_taken in ('confirmed', 'cancelled') and m.crm_writeback_ok is not true) then 'writeback_attention'
      when m.status = 'failed' then 'send_failed'
      when m.status = 'send_unknown' and m.response is null and m.action_taken = 'none' then 'send_unknown'
      when m.status = 'skipped' and m.skip_reason in ('no_phone', 'invalid_phone', 'missing_patient', 'patient_merged_or_unresolved', 'patient_changed', 'unknown_status', 'not_enabled', 'provider_pre_submit_failure') then 'staff_data_fix'
      when m.status = 'superseded' then 'stale_or_moved'
      else 'normal'
    end as staff_state,
    m.staff_reason_tag,
    m.staff_reason_tagged_at,
    m.skip_reason,
    m.action_taken,
    m.crm_writeback_ok,
    (
      m.action_taken in ('pending_staff_review', 'error')
      or (m.action_taken in ('confirmed', 'cancelled') and m.crm_writeback_ok is not true)
      or m.status in ('failed', 'send_unknown', 'superseded')
      or m.skip_reason is not null
    ) as needs_attention,
    latest_run.id as latest_run_id,
    latest_run.pass_kind as latest_pass_kind,
    latest_run.finished_at as latest_run_finished_at,
    d.health as day_health,
    d.cliniccards_total,
    d.remindable_total,
    d.sendable_total,
    d.sent_total,
    d.skipped_total,
    d.failed_total,
    d.send_unknown_total,
    d.pending_total,
    d.unaccounted_total,
    d.health in ('green', 'amber') as success_heartbeat_sent
  from app.reminder_messages m
  left join app.patients p on p.id = m.patient_id
  left join app.reminder_days d on d.target_date = m.target_date
  left join lateral (
    select r.id, r.pass_kind, r.finished_at
      from app.reminder_runs r
     where r.target_date = m.target_date
     order by r.started_at desc, r.id desc
     limit 1
  ) latest_run on true
  where m.target_date >= (app.now() at time zone 'Europe/Kyiv')::date
  order by m.target_at, m.id;
$$;

create or replace function api.dashboard_needs_attention_rows()
returns table (
  message_id bigint,
  target_date date,
  target_at timestamptz,
  target_time_kyiv text,
  cliniccards_visit_id text,
  patient_display text,
  patient_phone_last4 text,
  source_status text,
  send_state text,
  response_state text,
  staff_state text,
  staff_reason_tag text,
  staff_reason_tagged_at timestamptz,
  skip_reason text,
  action_taken text,
  crm_writeback_ok boolean,
  needs_attention boolean,
  latest_run_id bigint,
  latest_pass_kind text,
  latest_run_finished_at timestamptz,
  day_health text,
  cliniccards_total int,
  remindable_total int,
  sendable_total int,
  sent_total int,
  skipped_total int,
  failed_total int,
  send_unknown_total int,
  pending_total int,
  unaccounted_total int,
  success_heartbeat_sent boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select *
    from api.dashboard_board_rows()
   where needs_attention
   order by
     case staff_state
       when 'writeback_attention' then 1
       when 'held_cancel' then 2
       when 'blocked_allowlist' then 3
       when 'send_failed' then 4
       when 'send_unknown' then 5
       else 6
     end,
     target_at,
     message_id;
$$;

create or replace view api.v_board
with (security_invoker = true)
as select * from api.dashboard_board_rows();

create or replace view api.v_needs_attention
with (security_invoker = true)
as select * from api.dashboard_needs_attention_rows();

create or replace function api.update_message_template(
  p_template_id bigint,
  p_body text,
  p_actor text default null
)
returns table (
  id bigint,
  key text,
  channel text,
  language text,
  body text,
  version int,
  active boolean,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  existing app.message_templates%rowtype;
  inserted app.message_templates%rowtype;
  next_version int;
  actor text := coalesce(nullif(p_actor, ''), nullif(current_setting('request.jwt.claim.sub', true), ''), 'staff_dashboard');
begin
  perform private.assert_sms_template_body(p_body);

  select *
    into existing
    from app.message_templates
   where app.message_templates.id = p_template_id
   for update;

  if not found then
    raise exception 'Message template not found' using errcode = '22023';
  end if;

  select coalesce(max(app.message_templates.version), 0) + 1
    into next_version
    from app.message_templates
   where app.message_templates.key = existing.key
     and app.message_templates.channel = existing.channel
     and app.message_templates.language = existing.language;

  update app.message_templates
     set active = false,
         updated_at = app.now()
   where app.message_templates.key = existing.key
     and app.message_templates.channel = existing.channel
     and app.message_templates.language = existing.language
     and app.message_templates.active is true;

  insert into app.message_templates(key, channel, language, body, buttons, version, active, updated_at)
  values (existing.key, existing.channel, existing.language, btrim(p_body), existing.buttons, next_version, true, app.now())
  returning *
    into inserted;

  insert into app.audit_log(actor, action, detail)
  values (
    actor,
    'update_message_template',
    jsonb_build_object(
      'previous_template_id', existing.id,
      'new_template_id', inserted.id,
      'key', inserted.key,
      'channel', inserted.channel,
      'language', inserted.language,
      'version', inserted.version
    )
  );

  return query select
    inserted.id,
    inserted.key,
    inserted.channel,
    inserted.language,
    inserted.body,
    inserted.version,
    inserted.active,
    inserted.updated_at;
end;
$$;

create or replace function api.resolve_held_cancels(
  p_target_date date,
  p_message_ids bigint[] default null,
  p_resolution text default 'staff_closed_no_write',
  p_actor text default null,
  p_revalidation jsonb default '{}'::jsonb
)
returns table (
  message_id bigint,
  action_taken text,
  crm_writeback_ok boolean
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  resolved_count integer;
  actor text := coalesce(nullif(p_actor, ''), nullif(current_setting('request.jwt.claim.sub', true), ''), 'staff_dashboard');
begin
  if p_resolution not in ('staff_closed_no_write', 'bulk_approved_safe') then
    raise exception 'Unsupported held-cancel resolution' using errcode = '22023';
  end if;

  if p_resolution = 'bulk_approved_safe' and exists (
    select 1
      from app.reminder_messages candidate
     where candidate.target_date = p_target_date
       and candidate.action_taken = 'pending_staff_review'
       and candidate.response = 'cancel'
       and (p_message_ids is null or candidate.id = any(p_message_ids))
       and coalesce(p_revalidation -> (candidate.id::text) ->> 'appointment_fingerprint', '') <> coalesce(candidate.appointment_fingerprint, '')
  ) then
    raise exception 'Live revalidation evidence is required before approving held cancel writes' using errcode = '22023';
  end if;

  update app.reminder_messages
     set action_taken = case p_resolution
           when 'bulk_approved_safe' then 'cancelled'
           else 'staff_closed_no_write'
         end,
         crm_writeback_ok = case p_resolution
           when 'bulk_approved_safe' then null
           else false
         end,
         error = case p_resolution
           when 'bulk_approved_safe' then 'staff approved held cancel after live revalidation; guarded write-back pending'
           else null
         end
   where app.reminder_messages.target_date = p_target_date
     and app.reminder_messages.action_taken = 'pending_staff_review'
     and app.reminder_messages.response = 'cancel'
     and (p_message_ids is null or app.reminder_messages.id = any(p_message_ids));

  get diagnostics resolved_count = row_count;

  insert into app.audit_log(actor, action, detail)
  values (
    actor,
    'resolve_held_cancels',
    jsonb_build_object(
      'target_date', p_target_date,
      'resolution', p_resolution,
      'message_ids', coalesce(to_jsonb(p_message_ids), 'null'::jsonb),
      'resolved_count', resolved_count,
      'revalidation_message_ids', coalesce((select jsonb_agg(key) from jsonb_object_keys(p_revalidation) as key), '[]'::jsonb)
    )
  );

  return query
    select m.id, m.action_taken, m.crm_writeback_ok
      from app.reminder_messages m
     where m.target_date = p_target_date
       and m.response = 'cancel'
       and (p_message_ids is null or m.id = any(p_message_ids))
     order by m.id;
end;
$$;

create or replace function api.record_no_reply_reason_tag(
  p_message_id bigint,
  p_reason text,
  p_actor text default null
)
returns table (
  message_id bigint,
  staff_reason_tag text,
  staff_reason_tagged_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := coalesce(nullif(p_actor, ''), nullif(current_setting('request.jwt.claim.sub', true), ''), 'staff_dashboard');
  normalized_reason text := nullif(btrim(coalesce(p_reason, '')), '');
  updated_message app.reminder_messages%rowtype;
begin
  if normalized_reason is null or normalized_reason not in ('did_not_see_sms', 'distrusts_link', 'prefers_call', 'could_not_reach') then
    raise exception 'Unsupported no-reply reason tag' using errcode = '22023';
  end if;

  update app.reminder_messages
     set staff_reason_tag = normalized_reason,
         staff_reason_tagged_at = app.now(),
         staff_reason_tagged_by = actor
   where app.reminder_messages.id = p_message_id
     and app.reminder_messages.response is null
     and app.reminder_messages.action_taken = 'none'
     and app.reminder_messages.status in ('sent', 'delivered')
  returning *
    into updated_message;

  if not found then
    raise exception 'No active no-reply reminder message found' using errcode = '22023';
  end if;

  insert into app.audit_log(actor, action, detail)
  values (
    actor,
    'record_no_reply_reason_tag',
    jsonb_build_object(
      'message_id', updated_message.id,
      'reason', normalized_reason,
      'target_date', updated_message.target_date,
      'cliniccards_visit_id', updated_message.cliniccards_visit_id
    )
  );

  return query select
    updated_message.id,
    updated_message.staff_reason_tag,
    updated_message.staff_reason_tagged_at;
end;
$$;

create or replace function api.reenable_sms_reminders(
  p_patient_id bigint,
  p_actor text default null,
  p_proof_ref text default null
)
returns table (
  patient_id bigint,
  sms_reminders_enabled boolean,
  sms_reminders_status text,
  consent_event_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := coalesce(nullif(p_actor, ''), nullif(current_setting('request.jwt.claim.sub', true), ''), 'staff_dashboard');
  inserted_consent_id bigint;
  updated_patient app.patients%rowtype;
begin
  if not exists (select 1 from app.patients where app.patients.id = p_patient_id) then
    raise exception 'Patient not found' using errcode = '22023';
  end if;

  insert into app.consent_events(
    patient_id,
    status,
    source,
    legal_basis,
    proof_ref,
    captured_by,
    request_meta
  )
  values (
    p_patient_id,
    'staff_reenabled',
    'staff_dashboard',
    'contract',
    nullif(p_proof_ref, ''),
    actor,
    jsonb_build_object('path', 'api.reenable_sms_reminders')
  )
  returning id
    into inserted_consent_id;

  update app.patients
     set sms_reminders_enabled = true,
         sms_reminders_status = 'enabled',
         last_consent_event_id = inserted_consent_id,
         sms_reminders_set_at = app.now(),
         updated_at = app.now()
   where app.patients.id = p_patient_id
  returning *
    into updated_patient;

  insert into app.audit_log(actor, action, detail)
  values (
    actor,
    'reenable_sms_reminders',
    jsonb_build_object('patient_id', p_patient_id, 'consent_event_id', inserted_consent_id)
  );

  return query select
    updated_patient.id,
    updated_patient.sms_reminders_enabled,
    updated_patient.sms_reminders_status,
    inserted_consent_id;
end;
$$;

alter function api.dashboard_board_rows() owner to dentino_dashboard_definer;
alter function api.dashboard_needs_attention_rows() owner to dentino_dashboard_definer;
alter function api.update_message_template(bigint, text, text) owner to dentino_dashboard_definer;
alter function api.resolve_held_cancels(date, bigint[], text, text, jsonb) owner to dentino_dashboard_definer;
alter function api.record_no_reply_reason_tag(bigint, text, text) owner to dentino_dashboard_definer;
alter function api.reenable_sms_reminders(bigint, text, text) owner to dentino_dashboard_definer;
alter view api.v_board owner to dentino_dashboard_definer;
alter view api.v_needs_attention owner to dentino_dashboard_definer;

revoke all on api.v_board from public, anon, dentino_confirm_api, dentino_run_api, dentino_maintenance_runner;
revoke all on api.v_needs_attention from public, anon, dentino_confirm_api, dentino_run_api, dentino_maintenance_runner;
grant select on api.v_board to authenticated;
grant select on api.v_needs_attention to authenticated;

revoke execute on function api.dashboard_board_rows() from public, anon, dentino_confirm_api, dentino_run_api, dentino_maintenance_runner;
revoke execute on function api.dashboard_needs_attention_rows() from public, anon, dentino_confirm_api, dentino_run_api, dentino_maintenance_runner;
revoke execute on function api.update_message_template(bigint, text, text) from public, anon, dentino_confirm_api, dentino_run_api, dentino_maintenance_runner;
revoke execute on function api.resolve_held_cancels(date, bigint[], text, text, jsonb) from public, anon, dentino_confirm_api, dentino_run_api, dentino_maintenance_runner;
revoke execute on function api.record_no_reply_reason_tag(bigint, text, text) from public, anon, dentino_confirm_api, dentino_run_api, dentino_maintenance_runner;
revoke execute on function api.reenable_sms_reminders(bigint, text, text) from public, anon, dentino_confirm_api, dentino_run_api, dentino_maintenance_runner;
grant execute on function api.dashboard_board_rows() to authenticated;
grant execute on function api.dashboard_needs_attention_rows() to authenticated;
grant execute on function api.update_message_template(bigint, text, text) to authenticated;
grant execute on function api.resolve_held_cancels(date, bigint[], text, text, jsonb) to authenticated;
grant execute on function api.record_no_reply_reason_tag(bigint, text, text) to authenticated;
grant execute on function api.reenable_sms_reminders(bigint, text, text) to authenticated;
