create extension if not exists pgcrypto with schema extensions;

create type public.profile_role as enum ('student', 'officer', 'admin');
create type public.attendance_session_status as enum (
  'draft',
  'scheduled',
  'open',
  'completed',
  'cancelled'
);
create type public.attendance_status as enum ('present', 'late', 'absent');
create type public.attendance_qr_status as enum ('active', 'used', 'expired', 'revoked');
create type public.notification_type as enum (
  'attendance_opened',
  'attendance_registered',
  'attendance_completed',
  'system'
);

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  first_name text,
  last_name text,
  email text,
  course text,
  year text,
  block text,
  team text,
  role public.profile_role not null default 'student',
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index profiles_email_lower_unique
  on public.profiles (lower(email))
  where email is not null;

create table public.attendance_sessions (
  id uuid primary key default gen_random_uuid(),
  title text not null check (length(trim(title)) > 0),
  description text,
  created_by uuid not null references public.profiles (id) on delete restrict,
  start_time timestamptz not null,
  end_time timestamptz not null,
  late_after timestamptz,
  status public.attendance_session_status not null default 'draft',
  created_at timestamptz not null default now(),
  constraint attendance_sessions_valid_window
    check (end_time > start_time),
  constraint attendance_sessions_valid_late_after
    check (late_after is null or late_after between start_time and end_time)
);

create index attendance_sessions_status_window_idx
  on public.attendance_sessions (status, start_time, end_time);
create index attendance_sessions_created_by_idx
  on public.attendance_sessions (created_by, created_at desc);

create table public.attendance_records (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions (id) on delete restrict,
  student_id uuid not null references public.profiles (id) on delete restrict,
  registered_at timestamptz not null default now(),
  attendance_status public.attendance_status not null default 'present',
  scanned_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  constraint attendance_records_one_per_student_session unique (session_id, student_id)
);

create index attendance_records_student_registered_idx
  on public.attendance_records (student_id, registered_at desc);

create table public.attendance_qr (
  id uuid primary key default gen_random_uuid(),
  student_id uuid not null references public.profiles (id) on delete cascade,
  session_id uuid not null references public.attendance_sessions (id) on delete cascade,
  token_hash bytea not null unique check (octet_length(token_hash) = 32),
  expires_at timestamptz not null,
  created_at timestamptz not null default now(),
  used_at timestamptz,
  status public.attendance_qr_status not null default 'active',
  constraint attendance_qr_expiry_after_creation check (expires_at > created_at),
  constraint attendance_qr_used_status_consistent
    check ((status = 'used') = (used_at is not null))
);

create unique index attendance_qr_one_active_per_student_session
  on public.attendance_qr (student_id, session_id)
  where status = 'active';
create index attendance_qr_expiry_idx
  on public.attendance_qr (expires_at)
  where status = 'active';

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  title text not null check (length(trim(title)) > 0),
  message text not null,
  type public.notification_type not null default 'system',
  is_read boolean not null default false,
  created_at timestamptz not null default now()
);

create index notifications_user_created_idx
  on public.notifications (user_id, created_at desc);
create index notifications_unread_idx
  on public.notifications (user_id, created_at desc)
  where is_read = false;

create or replace function public.set_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
before update on public.profiles
for each row execute function public.set_updated_at();

create or replace function public.handle_auth_user_profile()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, first_name, last_name)
  values (
    new.id,
    new.email,
    nullif(new.raw_user_meta_data ->> 'first_name', ''),
    nullif(new.raw_user_meta_data ->> 'last_name', '')
  )
  on conflict (id) do update
  set email = excluded.email,
      updated_at = now();

  return new;
end;
$$;

create trigger on_auth_user_profile_created_or_email_updated
after insert or update of email on auth.users
for each row execute function public.handle_auth_user_profile();

create or replace function public.current_profile_role()
returns public.profile_role
language sql
stable
security definer
set search_path = ''
as $$
  select profile.role
  from public.profiles as profile
  where profile.id = (select auth.uid())
$$;

revoke all on function public.set_updated_at() from public, anon, authenticated;
revoke all on function public.handle_auth_user_profile() from public, anon, authenticated;
revoke all on function public.current_profile_role() from public, anon;
grant execute on function public.current_profile_role() to authenticated;

create or replace function public.issue_attendance_qr(p_session_id uuid)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_session_status public.attendance_session_status;
  v_token text;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if (select public.current_profile_role()) is distinct from 'student'::public.profile_role then
    raise exception using errcode = '42501', message = 'Only students can request an attendance QR';
  end if;

  select session.start_time, session.end_time, session.status
  into v_start_time, v_end_time, v_session_status
  from public.attendance_sessions as session
  where session.id = p_session_id
  for share;

  if not found then
    raise exception using errcode = 'P0002', message = 'Attendance session not found';
  end if;

  if v_session_status <> 'open'
     or v_now < v_start_time
     or v_now >= v_end_time then
    raise exception using errcode = '22023', message = 'Attendance session is not accepting registrations';
  end if;

  if exists (
    select 1
    from public.attendance_records as record
    where record.session_id = p_session_id
      and record.student_id = (select auth.uid())
  ) then
    raise exception using errcode = '23505', message = 'Attendance is already recorded for this session';
  end if;

  update public.attendance_qr
  set status = 'revoked'
  where student_id = (select auth.uid())
    and session_id = p_session_id
    and status = 'active';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');

  insert into public.attendance_qr (
    student_id,
    session_id,
    token_hash,
    expires_at
  )
  values (
    (select auth.uid()),
    p_session_id,
    extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'),
    least(v_now + interval '5 minutes', v_end_time)
  );

  return v_token;
end;
$$;

create or replace function public.register_attendance_from_qr(p_token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_qr_id uuid;
  v_student_id uuid;
  v_session_id uuid;
  v_actor_role public.profile_role;
  v_qr_status public.attendance_qr_status;
  v_expires_at timestamptz;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_late_after timestamptz;
  v_session_status public.attendance_session_status;
  v_record_id uuid;
  v_attendance_status public.attendance_status;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  v_actor_role := (select public.current_profile_role());

  if v_actor_role is distinct from 'officer'::public.profile_role
     and v_actor_role is distinct from 'admin'::public.profile_role then
    raise exception using errcode = '42501', message = 'Only officers can register QR attendance';
  end if;

  if p_token is null or p_token !~ '^[0-9a-f]{64}$' then
    raise exception using errcode = '22023', message = 'Invalid attendance QR token';
  end if;

  select qr.id, qr.student_id, qr.session_id, qr.status, qr.expires_at
  into v_qr_id, v_student_id, v_session_id, v_qr_status, v_expires_at
  from public.attendance_qr as qr
  where qr.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256')
  for update;

  if not found
     or v_qr_status <> 'active'
     or v_expires_at <= v_now then
    raise exception using errcode = '22023', message = 'Attendance QR token is invalid or expired';
  end if;

  select session.start_time, session.end_time, session.late_after, session.status
  into v_start_time, v_end_time, v_late_after, v_session_status
  from public.attendance_sessions as session
  where session.id = v_session_id;

  if v_session_status <> 'open'
     or v_now < v_start_time
     or v_now >= v_end_time then
    raise exception using errcode = '22023', message = 'Attendance session is not accepting registrations';
  end if;

  select record.id
  into v_record_id
  from public.attendance_records as record
  where record.session_id = v_session_id
    and record.student_id = v_student_id;

  if found then
    update public.attendance_qr
    set status = 'used', used_at = v_now
    where id = v_qr_id;
    return v_record_id;
  end if;

  v_attendance_status := case
    when v_late_after is not null and v_now > v_late_after then 'late'::public.attendance_status
    else 'present'::public.attendance_status
  end;

  insert into public.attendance_records (
    session_id,
    student_id,
    registered_at,
    attendance_status,
    scanned_by
  )
  values (
    v_session_id,
    v_student_id,
    v_now,
    v_attendance_status,
    (select auth.uid())
  )
  returning id into v_record_id;

  update public.attendance_qr
  set status = 'used', used_at = v_now
  where id = v_qr_id;

  return v_record_id;
end;
$$;

revoke all on function public.issue_attendance_qr(uuid) from public, anon;
revoke all on function public.register_attendance_from_qr(text) from public, anon;
grant execute on function public.issue_attendance_qr(uuid) to authenticated;
grant execute on function public.register_attendance_from_qr(text) to authenticated;

alter table public.profiles enable row level security;
alter table public.attendance_sessions enable row level security;
alter table public.attendance_records enable row level security;
alter table public.attendance_qr enable row level security;
alter table public.notifications enable row level security;

revoke all on table public.profiles from anon, authenticated;
grant select (
  id, first_name, last_name, course, year, block, team, role, avatar_url, created_at, updated_at
) on public.profiles to authenticated;
grant update (first_name, last_name, avatar_url)
  on public.profiles to authenticated;

create policy profiles_read_self_and_staff
on public.profiles for select to authenticated
using (
  id = (select auth.uid())
  or (select public.current_profile_role()) in (
    'officer'::public.profile_role,
    'admin'::public.profile_role
  )
);

create policy profiles_update_self_or_admin
on public.profiles for update to authenticated
using (
  id = (select auth.uid())
  or (select public.current_profile_role()) = 'admin'::public.profile_role
)
with check (
  id = (select auth.uid())
  or (select public.current_profile_role()) = 'admin'::public.profile_role
);

revoke all on table public.attendance_sessions from anon, authenticated;
grant select, insert, update on public.attendance_sessions to authenticated;

create policy attendance_sessions_read_available_or_owned
on public.attendance_sessions for select to authenticated
using (
  created_by = (select auth.uid())
  or (select public.current_profile_role()) = 'admin'::public.profile_role
  or (
    status in ('scheduled'::public.attendance_session_status, 'open'::public.attendance_session_status, 'completed'::public.attendance_session_status)
    and (select public.current_profile_role()) in (
      'student'::public.profile_role,
      'officer'::public.profile_role
    )
  )
);

create policy attendance_sessions_insert_by_staff
on public.attendance_sessions for insert to authenticated
with check (
  created_by = (select auth.uid())
  and (select public.current_profile_role()) in (
    'officer'::public.profile_role,
    'admin'::public.profile_role
  )
);

create policy attendance_sessions_update_by_owner_or_admin
on public.attendance_sessions for update to authenticated
using (
  (created_by = (select auth.uid()) and (select public.current_profile_role()) = 'officer'::public.profile_role)
  or (select public.current_profile_role()) = 'admin'::public.profile_role
)
with check (
  (created_by = (select auth.uid()) and (select public.current_profile_role()) = 'officer'::public.profile_role)
  or (select public.current_profile_role()) = 'admin'::public.profile_role
);

revoke all on table public.attendance_records from anon, authenticated;
grant select on public.attendance_records to authenticated;

create policy attendance_records_read_self_owner_or_admin
on public.attendance_records for select to authenticated
using (
  student_id = (select auth.uid())
  or (select public.current_profile_role()) = 'admin'::public.profile_role
  or exists (
    select 1
    from public.attendance_sessions as session
    where session.id = attendance_records.session_id
      and session.created_by = (select auth.uid())
  )
);

grant update (attendance_status) on public.attendance_records to authenticated;

create policy attendance_records_update_status_by_owner_or_admin
on public.attendance_records for update to authenticated
using (
  (select public.current_profile_role()) = 'admin'::public.profile_role
  or (
    (select public.current_profile_role()) = 'officer'::public.profile_role
    and exists (
      select 1
      from public.attendance_sessions as session
      where session.id = attendance_records.session_id
        and session.created_by = (select auth.uid())
    )
  )
)
with check (
  (select public.current_profile_role()) = 'admin'::public.profile_role
  or (
    (select public.current_profile_role()) = 'officer'::public.profile_role
    and exists (
      select 1
      from public.attendance_sessions as session
      where session.id = attendance_records.session_id
        and session.created_by = (select auth.uid())
    )
  )
);

revoke all on table public.attendance_qr from anon, authenticated;

revoke all on table public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (is_read) on public.notifications to authenticated;

create policy notifications_read_own
on public.notifications for select to authenticated
using (user_id = (select auth.uid()));

create policy notifications_mark_own_read
on public.notifications for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));