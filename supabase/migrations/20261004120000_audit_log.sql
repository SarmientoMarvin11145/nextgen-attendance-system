create table public.audit_logs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references public.profiles (id) on delete set null,
  action text not null check (action in (
    'officer_created_attendance',
    'officer_closed_attendance',
    'officer_scanned_qr',
    'student_registered_attendance',
    'student_updated_profile',
    'admin_modified_student_information'
  )),
  entity_type text not null check (entity_type in ('attendance_session', 'attendance_record', 'profile')),
  entity_id uuid not null,
  metadata jsonb not null default '{}'::jsonb check (pg_column_size(metadata) <= 8192),
  created_at timestamptz not null default now()
);

create index audit_logs_actor_created_idx
  on public.audit_logs (user_id, created_at desc);
create index audit_logs_entity_created_idx
  on public.audit_logs (entity_type, entity_id, created_at desc);

alter table public.audit_logs enable row level security;
revoke all on table public.audit_logs from anon, authenticated;
grant select on public.audit_logs to authenticated;

create policy audit_logs_read_actor_or_admin
on public.audit_logs for select to authenticated
using (
  user_id = (select auth.uid())
  or (select public.current_profile_role()) = 'admin'::public.profile_role
);

create or replace function public.audit_attendance_session_changes()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      new.created_by,
      'officer_created_attendance',
      'attendance_session',
      new.id,
      jsonb_build_object('status', new.status)
    );
    return new;
  end if;

  if old.status = 'open'::public.attendance_session_status
     and new.status in (
       'completed'::public.attendance_session_status,
       'cancelled'::public.attendance_session_status
     ) then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      coalesce((select auth.uid()), new.created_by),
      'officer_closed_attendance',
      'attendance_session',
      new.id,
      jsonb_build_object('status', new.status)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.audit_attendance_session_changes() from public, anon, authenticated;

create trigger attendance_sessions_audit_insert
after insert on public.attendance_sessions
for each row execute function public.audit_attendance_session_changes();

create trigger attendance_sessions_audit_close
after update of status on public.attendance_sessions
for each row execute function public.audit_attendance_session_changes();

create or replace function public.audit_attendance_record_insert()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
  values (
    new.student_id,
    'student_registered_attendance',
    'attendance_record',
    new.id,
    jsonb_build_object('attendance_status', new.attendance_status)
  );

  if new.scanned_by is not null then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      new.scanned_by,
      'officer_scanned_qr',
      'attendance_record',
      new.id,
      jsonb_build_object('attendance_status', new.attendance_status)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.audit_attendance_record_insert() from public, anon, authenticated;

create trigger attendance_records_audit_insert
after insert on public.attendance_records
for each row execute function public.audit_attendance_record_insert();

create or replace function public.audit_profile_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_changed_fields text[];
  v_action text;
begin
  if old.role <> 'student'::public.profile_role then
    return new;
  end if;

  v_changed_fields := array_remove(array[
    case when new.first_name is distinct from old.first_name then 'first_name' end,
    case when new.last_name is distinct from old.last_name then 'last_name' end,
    case when new.course is distinct from old.course then 'course' end,
    case when new.year is distinct from old.year then 'year' end,
    case when new.block is distinct from old.block then 'block' end,
    case when new.team is distinct from old.team then 'team' end,
    case when new.avatar_url is distinct from old.avatar_url then 'avatar_url' end
  ], null);

  if cardinality(v_changed_fields) = 0 or v_actor_id is null then
    return new;
  end if;

  select case
    when profile.role = 'admin'::public.profile_role then 'admin_modified_student_information'
    else 'student_updated_profile'
  end
  into v_action
  from public.profiles as profile
  where profile.id = v_actor_id;

  if v_action is not null then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      v_actor_id,
      v_action,
      'profile',
      new.id,
      jsonb_build_object('changed_fields', v_changed_fields)
    );
  end if;

  return new;
end;
$$;

revoke all on function public.audit_profile_update() from public, anon, authenticated;

create trigger profiles_audit_student_update
after update on public.profiles
for each row execute function public.audit_profile_update();