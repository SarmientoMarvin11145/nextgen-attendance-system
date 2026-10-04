alter table public.school_locations rename to attendance_gates;
alter table public.attendance_qr rename column school_location_id to gate_id;
alter table public.attendance_records rename column school_location_id to gate_id;

alter table public.attendance_gates
  add column code text,
  add column description text not null default '',
  add column created_by uuid references public.profiles (id) on delete set null;

with numbered_gates as (
  select id, row_number() over (order by created_at, id) as gate_number
  from public.attendance_gates
)
update public.attendance_gates as gate
set code = 'GATE-' || lpad(numbered_gates.gate_number::text, 2, '0')
from numbered_gates
where numbered_gates.id = gate.id;

alter table public.attendance_gates
  alter column code set not null,
  add constraint attendance_gates_code_format check (code ~ '^[A-Z0-9][A-Z0-9-]{1,31}$');

create unique index attendance_gates_code_unique on public.attendance_gates (lower(code));

alter table public.attendance_sessions
  add column all_gates boolean not null default true;

create table public.attendance_session_gates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.attendance_sessions (id) on delete cascade,
  gate_id uuid not null references public.attendance_gates (id) on delete restrict,
  is_open boolean not null default true,
  created_at timestamptz not null default now(),
  unique (session_id, gate_id)
);

create index attendance_session_gates_gate_idx
  on public.attendance_session_gates (gate_id, session_id);

alter table public.attendance_session_gates enable row level security;
revoke all on table public.attendance_session_gates from anon, authenticated;
grant select (id, session_id, gate_id, is_open, created_at) on public.attendance_session_gates to authenticated;

create policy attendance_session_gates_read_allowed
on public.attendance_session_gates for select to authenticated
using (
  exists (
    select 1
    from public.attendance_sessions as session
    where session.id = attendance_session_gates.session_id
      and (
        (select public.current_profile_role()) = 'admin'::public.profile_role
        or (
          (select public.current_profile_role()) = 'officer'::public.profile_role
          and session.created_by = (select auth.uid())
        )
        or (
          (select public.current_profile_role()) = 'student'::public.profile_role
          and session.status in (
            'scheduled'::public.attendance_session_status,
            'open'::public.attendance_session_status,
            'completed'::public.attendance_session_status
          )
        )
      )
  )
);

drop policy school_locations_read_admin on public.attendance_gates;
drop policy school_locations_insert_admin on public.attendance_gates;
drop policy school_locations_update_admin on public.attendance_gates;

alter table public.attendance_gates enable row level security;
revoke all on table public.attendance_gates from anon, authenticated;

create or replace function public.admin_list_attendance_gates()
returns table (
  id uuid,
  code text,
  name text,
  description text,
  latitude numeric,
  longitude numeric,
  radius_meters integer,
  max_accuracy_meters integer,
  boundary_uncertainty_meters integer,
  is_active boolean,
  created_at timestamptz,
  updated_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_profile_role()) is distinct from 'admin'::public.profile_role then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;

  return query
  select gate.id, gate.code, gate.name, gate.description, gate.latitude, gate.longitude,
         gate.radius_meters, gate.max_accuracy_meters, gate.boundary_uncertainty_meters,
         gate.is_active, gate.created_at, gate.updated_at
  from public.attendance_gates as gate
  order by gate.name;
end;
$$;

revoke all on function public.admin_list_attendance_gates() from public, anon;
grant execute on function public.admin_list_attendance_gates() to authenticated;

create or replace function public.list_active_attendance_gates()
returns table (id uuid, code text, name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_profile_role()) not in (
    'student'::public.profile_role,
    'officer'::public.profile_role,
    'admin'::public.profile_role
  ) then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  return query
  select gate.id, gate.code, gate.name
  from public.attendance_gates as gate
  where gate.is_active
  order by gate.name;
end;
$$;

revoke all on function public.list_active_attendance_gates() from public, anon;
grant execute on function public.list_active_attendance_gates() to authenticated;

create or replace function public.list_staff_attendance_gates()
returns table (id uuid, code text, name text, is_active boolean)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select public.current_profile_role()) not in ('officer'::public.profile_role, 'admin'::public.profile_role) then
    raise exception using errcode = '42501', message = 'Staff access required';
  end if;

  return query
  select gate.id, gate.code, gate.name, gate.is_active
  from public.attendance_gates as gate
  order by gate.name;
end;
$$;

revoke all on function public.list_staff_attendance_gates() from public, anon;
grant execute on function public.list_staff_attendance_gates() to authenticated;

create or replace function public.get_session_gate_options(p_session_id uuid)
returns table (id uuid, code text, name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_all_gates boolean;
  v_session_status public.attendance_session_status;
  v_role public.profile_role := (select public.current_profile_role());
begin
  select session.all_gates, session.status
  into v_all_gates, v_session_status
  from public.attendance_sessions as session
  where session.id = p_session_id;

  if not found then
    raise exception using errcode = 'P0002', message = 'Attendance session not found';
  end if;

  if v_role not in ('student'::public.profile_role, 'officer'::public.profile_role, 'admin'::public.profile_role) then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  return query
  select gate.id, gate.code, gate.name
  from public.attendance_gates as gate
  where gate.is_active
    and (
      (v_all_gates and not exists (
        select 1 from public.attendance_session_gates as session_gate
        where session_gate.session_id = p_session_id
          and session_gate.gate_id = gate.id
          and not session_gate.is_open
      ))
      or (not v_all_gates and exists (
        select 1 from public.attendance_session_gates as session_gate
        where session_gate.session_id = p_session_id
          and session_gate.gate_id = gate.id
          and session_gate.is_open
      ))
    )
  order by gate.name;
end;
$$;

revoke all on function public.get_session_gate_options(uuid) from public, anon;
grant execute on function public.get_session_gate_options(uuid) to authenticated;

create or replace function public.get_staff_session_gate_options(p_session_ids uuid[])
returns table (session_id uuid, gate_id uuid, code text, name text)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.profile_role := (select public.current_profile_role());
begin
  if v_role not in ('officer'::public.profile_role, 'admin'::public.profile_role) then
    raise exception using errcode = '42501', message = 'Staff access required';
  end if;

  return query
  select session.id, gate.id, gate.code, gate.name
  from public.attendance_sessions as session
  join public.attendance_gates as gate on gate.is_active
  where session.id = any(p_session_ids)
    and session.status = 'open'::public.attendance_session_status
    and (v_role = 'admin'::public.profile_role or session.created_by = (select auth.uid()))
    and (
      (session.all_gates and not exists (
        select 1 from public.attendance_session_gates as session_gate
        where session_gate.session_id = session.id
          and session_gate.gate_id = gate.id
          and not session_gate.is_open
      ))
      or (not session.all_gates and exists (
        select 1 from public.attendance_session_gates as session_gate
        where session_gate.session_id = session.id
          and session_gate.gate_id = gate.id
          and session_gate.is_open
      ))
    )
  order by session.start_time, gate.name;
end;
$$;

revoke all on function public.get_staff_session_gate_options(uuid[]) from public, anon;
grant execute on function public.get_staff_session_gate_options(uuid[]) to authenticated;

create or replace function public.get_staff_session_gate_statuses(p_session_ids uuid[])
returns table (session_id uuid, gate_id uuid, code text, name text, is_active boolean, is_open boolean)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.profile_role := (select public.current_profile_role());
begin
  if v_role not in ('officer'::public.profile_role, 'admin'::public.profile_role) then
    raise exception using errcode = '42501', message = 'Staff access required';
  end if;

  return query
  select session.id,
         gate.id,
         gate.code,
         gate.name,
         gate.is_active,
         case
           when not gate.is_active then false
           when session.all_gates then coalesce(session_gate.is_open, true)
           else coalesce(session_gate.is_open, false)
         end
  from public.attendance_sessions as session
  join public.attendance_gates as gate on (
    session.all_gates
    or exists (
      select 1 from public.attendance_session_gates as selected_gate
      where selected_gate.session_id = session.id and selected_gate.gate_id = gate.id
    )
  )
  left join public.attendance_session_gates as session_gate
    on session_gate.session_id = session.id and session_gate.gate_id = gate.id
  where session.id = any(p_session_ids)
    and (v_role = 'admin'::public.profile_role or session.created_by = (select auth.uid()))
  order by session.start_time, gate.name;
end;
$$;

revoke all on function public.get_staff_session_gate_statuses(uuid[]) from public, anon;
grant execute on function public.get_staff_session_gate_statuses(uuid[]) to authenticated;

create or replace function public.set_attendance_session_gate(
  p_session_id uuid,
  p_gate_id uuid,
  p_is_open boolean
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.profile_role := (select public.current_profile_role());
  v_session public.attendance_sessions%rowtype;
begin
  if v_role is distinct from 'admin'::public.profile_role
     and v_role is distinct from 'officer'::public.profile_role then
    raise exception using errcode = '42501', message = 'Staff access required';
  end if;

  select * into v_session
  from public.attendance_sessions as session
  where session.id = p_session_id
    and (v_role = 'admin'::public.profile_role or session.created_by = (select auth.uid()))
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'Attendance session is unavailable';
  end if;

  if not exists (select 1 from public.attendance_gates where id = p_gate_id) then
    raise exception using errcode = 'P0002', message = 'Attendance gate not found';
  end if;

  if p_is_open and v_session.all_gates then
    delete from public.attendance_session_gates
    where session_id = p_session_id and gate_id = p_gate_id;
    return;
  end if;

  if not p_is_open and not v_session.all_gates
     and not exists (
       select 1 from public.attendance_session_gates as session_gate
       where session_gate.session_id = p_session_id
         and session_gate.is_open
         and session_gate.gate_id <> p_gate_id
     ) then
    raise exception using errcode = '22023', message = 'At least one gate must remain open for this session';
  end if;

  insert into public.attendance_session_gates (session_id, gate_id, is_open)
  values (p_session_id, p_gate_id, p_is_open)
  on conflict (session_id, gate_id) do update set is_open = excluded.is_open;
end;
$$;

revoke all on function public.set_attendance_session_gate(uuid, uuid, boolean) from public, anon;
grant execute on function public.set_attendance_session_gate(uuid, uuid, boolean) to authenticated;

create or replace function public.get_session_gate_count(p_session_id uuid)
returns integer
language sql
stable
security definer
set search_path = ''
as $$
  select count(*)::integer from public.get_session_gate_options(p_session_id)
$$;

revoke all on function public.get_session_gate_count(uuid) from public, anon;
grant execute on function public.get_session_gate_count(uuid) to authenticated;

create or replace function public.get_session_gate_counts(p_session_ids uuid[])
returns table (session_id uuid, gate_count integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_role public.profile_role := (select public.current_profile_role());
begin
  if v_role not in ('student'::public.profile_role, 'officer'::public.profile_role, 'admin'::public.profile_role) then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  return query
  select requested.id, coalesce(available.gate_count, 0)::integer
  from unnest(p_session_ids) as requested(id)
  left join lateral (
    select count(*) as gate_count
    from public.get_session_gate_options(requested.id)
  ) as available on true;
end;
$$;

revoke all on function public.get_session_gate_counts(uuid[]) from public, anon;
grant execute on function public.get_session_gate_counts(uuid[]) to authenticated;

create or replace function public.save_attendance_gate(
  p_gate_id uuid,
  p_code text,
  p_name text,
  p_description text,
  p_latitude numeric,
  p_longitude numeric,
  p_radius_meters integer,
  p_max_accuracy_meters integer,
  p_boundary_uncertainty_meters integer,
  p_is_active boolean
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_gate_id uuid;
  v_actor_id uuid := (select auth.uid());
begin
  if (select public.current_profile_role()) is distinct from 'admin'::public.profile_role then
    raise exception using errcode = '42501', message = 'Administrator access required';
  end if;

  if p_code is null or upper(trim(p_code)) !~ '^[A-Z0-9][A-Z0-9-]{1,31}$'
     or p_name is null or length(trim(p_name)) not between 1 and 120
     or p_description is null or length(p_description) > 500
     or p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180
     or p_radius_meters is null or p_radius_meters <= 0
     or p_max_accuracy_meters is null or p_max_accuracy_meters <= 0
     or p_boundary_uncertainty_meters is null or p_boundary_uncertainty_meters < 0 then
    raise exception using errcode = '22023', message = 'Invalid attendance gate settings';
  end if;

  if p_gate_id is null then
    insert into public.attendance_gates (
      code, name, description, latitude, longitude, radius_meters,
      max_accuracy_meters, boundary_uncertainty_meters, is_active, created_by
    )
    values (
      upper(trim(p_code)), trim(p_name), trim(p_description), p_latitude, p_longitude,
      p_radius_meters, p_max_accuracy_meters, p_boundary_uncertainty_meters,
      coalesce(p_is_active, true), v_actor_id
    )
    returning id into v_gate_id;
  else
    update public.attendance_gates as gate
    set code = upper(trim(p_code)),
        name = trim(p_name),
        description = trim(p_description),
        latitude = p_latitude,
        longitude = p_longitude,
        radius_meters = p_radius_meters,
        max_accuracy_meters = p_max_accuracy_meters,
        boundary_uncertainty_meters = p_boundary_uncertainty_meters,
        is_active = coalesce(p_is_active, false)
    where gate.id = p_gate_id
    returning id into v_gate_id;

    if v_gate_id is null then
      raise exception using errcode = 'P0002', message = 'Attendance gate not found';
    end if;
  end if;

  return v_gate_id;
end;
$$;

revoke all on function public.save_attendance_gate(uuid, text, text, text, numeric, numeric, integer, integer, integer, boolean) from public, anon;
grant execute on function public.save_attendance_gate(uuid, text, text, text, numeric, numeric, integer, integer, integer, boolean) to authenticated;

create or replace function public.create_attendance_session_with_gates(
  p_title text,
  p_description text,
  p_start_time timestamptz,
  p_end_time timestamptz,
  p_location_requirement text,
  p_course_filter text,
  p_year_filter text,
  p_block_filter text,
  p_team_filter text,
  p_all_gates boolean,
  p_gate_ids uuid[]
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_id uuid := (select auth.uid());
  v_role public.profile_role := (select public.current_profile_role());
  v_session_id uuid;
  v_active_gate_count integer;
begin
  if v_actor_id is null or v_role not in ('officer'::public.profile_role, 'admin'::public.profile_role) then
    raise exception using errcode = '42501', message = 'Staff authentication required';
  end if;

  if p_title is null or length(trim(p_title)) not between 1 and 120
     or p_start_time is null or p_end_time is null or p_end_time <= p_start_time
     or p_location_requirement not in ('required', 'optional', 'disabled') then
    raise exception using errcode = '22023', message = 'Invalid attendance session';
  end if;

  if not coalesce(p_all_gates, false) then
    if coalesce(cardinality(p_gate_ids), 0) = 0 then
      raise exception using errcode = '22023', message = 'Select at least one attendance gate';
    end if;

    select count(*) into v_active_gate_count
    from public.attendance_gates as gate
    where gate.id = any(p_gate_ids)
      and gate.is_active;

    if v_active_gate_count <> cardinality(p_gate_ids) then
      raise exception using errcode = '22023', message = 'One or more selected gates are unavailable';
    end if;
  elsif not exists (select 1 from public.attendance_gates where is_active) then
    raise exception using errcode = '22023', message = 'At least one active attendance gate must be configured';
  end if;

  insert into public.attendance_sessions (
    title, description, created_by, start_time, end_time, status, location_requirement,
    course_filter, year_filter, block_filter, team_filter, all_gates
  )
  values (
    trim(p_title), nullif(trim(coalesce(p_description, '')), ''), v_actor_id,
    p_start_time, p_end_time, 'open'::public.attendance_session_status, p_location_requirement,
    p_course_filter, p_year_filter, p_block_filter, p_team_filter, p_all_gates
  )
  returning id into v_session_id;

  if not p_all_gates then
    insert into public.attendance_session_gates (session_id, gate_id)
    select v_session_id, selected_gate.id
    from unnest(p_gate_ids) as selected_gate(id);
  end if;

  return v_session_id;
end;
$$;

revoke all on function public.create_attendance_session_with_gates(text, text, timestamptz, timestamptz, text, text, text, text, text, boolean, uuid[]) from public, anon;
grant execute on function public.create_attendance_session_with_gates(text, text, timestamptz, timestamptz, text, text, text, text, text, boolean, uuid[]) to authenticated;