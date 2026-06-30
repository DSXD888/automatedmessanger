-- L4 go-live operational scaffold: audited mode flips and guard-liveness evidence.
-- Source of truth: research section 6.6, section 11 step 5, ADR-017, and ADR-024.

create or replace function api.record_go_live_mode_flip(
  p_actor text,
  p_prior_send_mode text,
  p_prior_crm_write_mode text,
  p_new_send_mode text,
  p_new_crm_write_mode text,
  p_target_date date default null,
  p_typed_confirmation text default null,
  p_context jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := coalesce(nullif(p_actor, ''), nullif(current_setting('request.jwt.claim.sub', true), ''), 'go_live_operator');
  safe_context jsonb := coalesce(p_context, '{}'::jsonb);
  typed_confirmation_required boolean := p_prior_crm_write_mode = 'off' and p_new_crm_write_mode <> 'off';
  expected_confirmation text;
  audit_detail jsonb;
  audit_id bigint;
begin
  if p_prior_send_mode not in ('off', 'seed', 'canary', 'full')
     or p_new_send_mode not in ('off', 'seed', 'canary', 'full')
     or p_prior_crm_write_mode not in ('off', 'allowlist', 'full')
     or p_new_crm_write_mode not in ('off', 'allowlist', 'full') then
    raise exception 'Unsupported go-live mode value' using errcode = '22023';
  end if;

  if not (
    (p_new_send_mode = 'off' and p_new_crm_write_mode = 'off')
    or (p_new_send_mode = 'seed' and p_new_crm_write_mode = 'off')
    or (p_new_send_mode = 'canary' and p_new_crm_write_mode = 'allowlist')
    or (p_new_send_mode = 'full' and p_new_crm_write_mode = 'full')
  ) then
    raise exception 'Unsupported go-live rung combination' using errcode = '22023';
  end if;

  if jsonb_typeof(safe_context) <> 'object'
     or exists (
       select 1
         from jsonb_each(safe_context) as entry(key, value)
        where jsonb_typeof(entry.value) not in ('number', 'boolean', 'null')
           or entry.key ~* '(phone|patient|token|url|name|email)'
     ) then
    raise exception 'Go-live mode-flip context must be counts-only' using errcode = '22023';
  end if;

  if typed_confirmation_required then
    if p_target_date is null then
      raise exception 'Target date is required for first live CRM write flip' using errcode = '22023';
    end if;

    expected_confirmation := 'ENABLE-LIVE-WRITES-' || to_char(p_target_date, 'YYYY-MM-DD');
    if coalesce(p_typed_confirmation, '') <> expected_confirmation then
      raise exception 'Typed confirmation token is required for first live CRM write flip' using errcode = '22023';
    end if;
  end if;

  audit_detail := jsonb_build_object(
    'prior', jsonb_build_object(
      'send_mode', p_prior_send_mode,
      'crm_write_mode', p_prior_crm_write_mode
    ),
    'new', jsonb_build_object(
      'send_mode', p_new_send_mode,
      'crm_write_mode', p_new_crm_write_mode
    ),
    'target_date', p_target_date,
    'typed_confirmation_required', typed_confirmation_required,
    'typed_confirmation_accepted', typed_confirmation_required,
    'counts', safe_context,
    'pause_available', true,
    'does_not_advance_modes', true
  );

  insert into app.audit_log(actor, action, detail)
  values (actor, 'go_live_mode_flip', audit_detail);
  audit_id := currval('app.audit_log_id_seq'::regclass);

  return audit_detail || jsonb_build_object('audit_id', audit_id);
end;
$$;

create or replace function maintenance.record_guard_liveness(
  p_effective_send_mode text,
  p_effective_crm_write_mode text,
  p_send_allowlist_count integer,
  p_crm_write_allowlist_count integer,
  p_dashboard_mode text,
  p_actor text default null,
  p_context jsonb default '{}'::jsonb
)
returns table (
  status text,
  alert boolean,
  audit_id bigint
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor text := coalesce(nullif(p_actor, ''), 'guard_liveness_schedule');
  safe_context jsonb := coalesce(p_context, '{}'::jsonb);
  normalized_dashboard_mode text := upper(coalesce(p_dashboard_mode, ''));
  expected_dashboard_mode text := 'INVALID';
  problems text[] := array[]::text[];
  audit_action text;
  audit_detail jsonb;
  recorded_audit_id bigint;
begin
  if p_effective_send_mode not in ('off', 'seed', 'canary', 'full')
     or p_effective_crm_write_mode not in ('off', 'allowlist', 'full') then
    raise exception 'Unsupported guard-liveness mode value' using errcode = '22023';
  end if;

  if jsonb_typeof(safe_context) <> 'object'
     or exists (
       select 1
         from jsonb_each(safe_context) as entry(key, value)
        where jsonb_typeof(entry.value) not in ('number', 'boolean', 'null')
           or entry.key ~* '(phone|patient|token|url|name|email)'
     ) then
    raise exception 'Guard-liveness context must be counts-only' using errcode = '22023';
  end if;

  if p_effective_send_mode = 'full' and p_effective_crm_write_mode = 'full' then
    expected_dashboard_mode := 'LIVE';
  elsif p_effective_send_mode = 'seed' and p_effective_crm_write_mode = 'off' then
    expected_dashboard_mode := 'SEED';
  elsif p_effective_send_mode = 'off' and p_effective_crm_write_mode = 'off' then
    expected_dashboard_mode := 'SHADOW';
  elsif p_effective_send_mode = 'canary' and p_effective_crm_write_mode = 'allowlist' then
    expected_dashboard_mode := 'CANARY';
  else
    problems := array_append(problems, 'unsupported_mode_combination');
  end if;

  if p_effective_send_mode in ('seed', 'canary') and coalesce(p_send_allowlist_count, 0) < 1 then
    problems := array_append(problems, 'send_allowlist_empty');
  end if;

  if p_effective_crm_write_mode = 'allowlist' and coalesce(p_crm_write_allowlist_count, 0) < 1 then
    problems := array_append(problems, 'crm_write_allowlist_empty');
  end if;

  if normalized_dashboard_mode <> expected_dashboard_mode then
    problems := array_append(problems, 'dashboard_mode_mismatch');
  end if;

  audit_action := case when cardinality(problems) = 0 then 'guard_liveness_ok' else 'guard_liveness_alert' end;
  audit_detail := jsonb_build_object(
    'effective', jsonb_build_object(
      'send_mode', p_effective_send_mode,
      'crm_write_mode', p_effective_crm_write_mode,
      'dashboard_mode', normalized_dashboard_mode
    ),
    'expected_dashboard_mode', expected_dashboard_mode,
    'send_allowlist_count', greatest(coalesce(p_send_allowlist_count, 0), 0),
    'crm_write_allowlist_count', greatest(coalesce(p_crm_write_allowlist_count, 0), 0),
    'problems', to_jsonb(problems),
    'counts', safe_context,
    'does_not_advance_modes', true,
    'pause_available', true
  );

  insert into app.audit_log(actor, action, detail)
  values (actor, audit_action, audit_detail);
  recorded_audit_id := currval('app.audit_log_id_seq'::regclass);

  return query select
    case when cardinality(problems) = 0 then 'ok' else 'alert' end,
    cardinality(problems) > 0,
    recorded_audit_id;
end;
$$;

alter function api.record_go_live_mode_flip(text, text, text, text, text, date, text, jsonb) owner to dentino_dashboard_definer;
alter function maintenance.record_guard_liveness(text, text, integer, integer, text, text, jsonb) owner to dentino_maintenance_definer;

revoke execute on function api.record_go_live_mode_flip(text, text, text, text, text, date, text, jsonb)
  from public, anon, dentino_confirm_api, dentino_run_api, dentino_maintenance_runner;
grant execute on function api.record_go_live_mode_flip(text, text, text, text, text, date, text, jsonb)
  to authenticated;

revoke execute on function maintenance.record_guard_liveness(text, text, integer, integer, text, text, jsonb)
  from public, anon, authenticated, dentino_confirm_api, dentino_run_api;
grant execute on function maintenance.record_guard_liveness(text, text, integer, integer, text, text, jsonb)
  to dentino_maintenance_runner;
