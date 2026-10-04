alter table public.school_locations
  add column boundary_uncertainty_meters integer not null default 30
    check (boundary_uncertainty_meters >= 0);

grant insert (boundary_uncertainty_meters) on public.school_locations to authenticated;
grant update (boundary_uncertainty_meters) on public.school_locations to authenticated;

create table public.application_settings (
  id boolean primary key default true check (id),
  school_timezone text not null default 'Asia/Manila',
  notify_attendance_open boolean not null default true,
  notify_attendance_reminder boolean not null default true,
  notify_attendance_closing boolean not null default true,
  reminder_minutes_before_close smallint not null default 10
    check (reminder_minutes_before_close between 6 and 60),
  notify_after_attendance boolean not null default true,
  updated_at timestamptz not null default now(),
  check (length(trim(school_timezone)) between 1 and 80)
);

insert into public.application_settings (id)
values (true)
on conflict (id) do nothing;

create trigger application_settings_set_updated_at
before update on public.application_settings
for each row execute function public.set_updated_at();

alter table public.application_settings enable row level security;
revoke all on table public.application_settings from anon, authenticated;
grant select on public.application_settings to authenticated;
grant update (
  school_timezone,
  notify_attendance_open,
  notify_attendance_reminder,
  notify_attendance_closing,
  reminder_minutes_before_close,
  notify_after_attendance
) on public.application_settings to authenticated;

create policy application_settings_read_admin
on public.application_settings for select to authenticated
using ((select public.current_profile_role()) = 'admin'::public.profile_role);

create policy application_settings_update_admin
on public.application_settings for update to authenticated
using ((select public.current_profile_role()) = 'admin'::public.profile_role)
with check ((select public.current_profile_role()) = 'admin'::public.profile_role);

create or replace function public.get_school_timezone()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select settings.school_timezone
  from public.application_settings as settings
  where settings.id = true
$$;

revoke all on function public.get_school_timezone() from public, anon;
grant execute on function public.get_school_timezone() to authenticated, service_role;

create or replace function public.get_school_now()
returns timestamptz
language sql
volatile
security definer
set search_path = ''
as $$
  select clock_timestamp()
$$;

revoke all on function public.get_school_now() from public, anon;
grant execute on function public.get_school_now() to authenticated, service_role;

create or replace function public.enforce_attendance_qr_location_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_radius_meters integer;
  v_uncertainty_meters integer;
  v_location_requirement text;
begin
  if not new.location_verified then
    return new;
  end if;

  select location.radius_meters, location.boundary_uncertainty_meters, session.location_requirement
  into v_radius_meters, v_uncertainty_meters, v_location_requirement
  from public.school_locations as location
  join public.attendance_sessions as session on session.id = new.session_id
  where location.id = new.school_location_id
    and location.is_active;

  if not found then
    raise exception using errcode = '42501', message = 'Active school location is unavailable';
  end if;

  if new.distance_from_school + new.location_accuracy + v_uncertainty_meters >= v_radius_meters then
    raise exception using errcode = 'P0001', message = 'Location is uncertain near the attendance boundary';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_attendance_qr_location_boundary() from public, anon, authenticated;

create trigger attendance_qr_enforce_location_boundary
before insert on public.attendance_qr
for each row execute function public.enforce_attendance_qr_location_boundary();