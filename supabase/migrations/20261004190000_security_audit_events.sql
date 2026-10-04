alter table public.audit_logs
  drop constraint audit_logs_action_check,
  drop constraint audit_logs_entity_type_check;

alter table public.audit_logs
  add constraint audit_logs_action_check check (action in (
    'officer_created_attendance',
    'officer_closed_attendance',
    'officer_scanned_qr',
    'student_registered_attendance',
    'student_updated_profile',
    'admin_modified_student_information',
    'LOCATION_PERMISSION_GRANTED',
    'LOCATION_VERIFICATION_SUCCESS',
    'LOCATION_VERIFICATION_FAILED',
    'ATTENDANCE_REJECTED_OUTSIDE_RADIUS',
    'PUSH_SUBSCRIPTION_CREATED',
    'PUSH_SUBSCRIPTION_REMOVED',
    'NOTIFICATION_SENT',
    'NOTIFICATION_FAILED'
  )),
  add constraint audit_logs_entity_type_check check (entity_type in (
    'attendance_session',
    'attendance_record',
    'profile',
    'push_subscription',
    'notification',
    'school_location'
  ));

grant insert on public.audit_logs to service_role;

create or replace function public.audit_push_subscription_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' or (tg_op = 'UPDATE' and not old.is_active and new.is_active) then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      new.user_id,
      'PUSH_SUBSCRIPTION_CREATED',
      'push_subscription',
      new.id,
      jsonb_build_object('device_name', new.device_name)
    );
    return new;
  end if;

  if tg_op = 'DELETE' or (old.is_active and not new.is_active) then
    insert into public.audit_logs (user_id, action, entity_type, entity_id)
    values (
      old.user_id,
      'PUSH_SUBSCRIPTION_REMOVED',
      'push_subscription',
      old.id
    );
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

revoke all on function public.audit_push_subscription_change() from public, anon, authenticated;

create trigger push_subscriptions_audit_insert
after insert on public.push_subscriptions
for each row execute function public.audit_push_subscription_change();

create trigger push_subscriptions_audit_delete
after delete on public.push_subscriptions
for each row execute function public.audit_push_subscription_change();

create trigger push_subscriptions_audit_status_change
after update of is_active on public.push_subscriptions
for each row when (old.is_active is distinct from new.is_active)
execute function public.audit_push_subscription_change();

create or replace function public.audit_verified_attendance_qr()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.location_verified then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      new.student_id,
      'LOCATION_VERIFICATION_SUCCESS',
      'attendance_session',
      new.session_id,
      jsonb_build_object(
        'school_location_id', new.school_location_id,
        'distance_meters', new.distance_from_school,
        'location_accuracy', new.location_accuracy,
        'verified_at', new.location_verified_at
      )
    );
  end if;
  return new;
end;
$$;

revoke all on function public.audit_verified_attendance_qr() from public, anon, authenticated;

create trigger attendance_qr_audit_location_verification
after insert on public.attendance_qr
for each row execute function public.audit_verified_attendance_qr();

create or replace function public.record_location_verification_attempt(
  p_session_id uuid,
  p_outcome text,
  p_distance_meters numeric default null,
  p_accuracy_meters numeric default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
  v_action text;
begin
  if v_user_id is null
     or (select public.current_profile_role()) is distinct from 'student'::public.profile_role then
    raise exception using errcode = '42501', message = 'Student authentication required';
  end if;

  if p_outcome not in ('accuracy_too_low', 'outside_area', 'location_uncertain', 'invalid_location', 'location_unavailable', 'location_not_provided') then
    raise exception using errcode = '22023', message = 'Invalid location verification outcome';
  end if;

  if not exists (select 1 from public.attendance_sessions where id = p_session_id) then
    raise exception using errcode = '22023', message = 'Attendance session not found';
  end if;

  v_action := case when p_outcome = 'outside_area'
    then 'ATTENDANCE_REJECTED_OUTSIDE_RADIUS'
    else 'LOCATION_VERIFICATION_FAILED'
  end;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id,
    v_action,
    'attendance_session',
    p_session_id,
    jsonb_strip_nulls(jsonb_build_object(
      'outcome', p_outcome,
      'distance_meters', p_distance_meters,
      'location_accuracy', p_accuracy_meters
    ))
  );
end;
$$;

revoke all on function public.record_location_verification_attempt(uuid, text, numeric, numeric) from public, anon;
grant execute on function public.record_location_verification_attempt(uuid, text, numeric, numeric) to authenticated;

create or replace function public.record_location_permission_submission(p_session_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user_id uuid := (select auth.uid());
begin
  if v_user_id is null
     or (select public.current_profile_role()) is distinct from 'student'::public.profile_role
     or not exists (select 1 from public.attendance_sessions where id = p_session_id) then
    raise exception using errcode = '42501', message = 'Student session required';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    v_user_id,
    'LOCATION_PERMISSION_GRANTED',
    'attendance_session',
    p_session_id,
    jsonb_build_object('source', 'location_submission')
  );
end;
$$;

revoke all on function public.record_location_permission_submission(uuid) from public, anon;
grant execute on function public.record_location_permission_submission(uuid) to authenticated;

create or replace function public.log_notification_delivery(
  p_user_id uuid,
  p_subscription_id uuid,
  p_notification_id uuid,
  p_succeeded boolean,
  p_is_test boolean default false,
  p_failure_code integer default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;

  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    p_user_id,
    case when p_succeeded then 'NOTIFICATION_SENT' else 'NOTIFICATION_FAILED' end,
    'push_subscription',
    p_subscription_id,
    jsonb_strip_nulls(jsonb_build_object(
      'notification_id', p_notification_id,
      'is_test', p_is_test,
      'failure_code', p_failure_code
    ))
  );
end;
$$;

revoke all on function public.log_notification_delivery(uuid, uuid, uuid, boolean, boolean, integer) from public, anon, authenticated;
grant execute on function public.log_notification_delivery(uuid, uuid, uuid, boolean, boolean, integer) to service_role;