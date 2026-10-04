create table public.school_locations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 120),
  latitude numeric(10, 7) not null check (latitude between -90 and 90),
  longitude numeric(10, 7) not null check (longitude between -180 and 180),
  radius_meters integer not null check (radius_meters > 0),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index school_locations_active_name_idx
  on public.school_locations (name)
  where is_active = true;

create trigger school_locations_set_updated_at
before update on public.school_locations
for each row execute function public.set_updated_at();

alter table public.school_locations enable row level security;
revoke all on table public.school_locations from anon, authenticated;
grant select on public.school_locations to authenticated;
grant insert (name, latitude, longitude, radius_meters, is_active)
  on public.school_locations to authenticated;
grant update (name, latitude, longitude, radius_meters, is_active)
  on public.school_locations to authenticated;

create policy school_locations_read_admin
on public.school_locations for select to authenticated
using ((select public.current_profile_role()) = 'admin'::public.profile_role);

create policy school_locations_insert_admin
on public.school_locations for insert to authenticated
with check ((select public.current_profile_role()) = 'admin'::public.profile_role);

create policy school_locations_update_admin
on public.school_locations for update to authenticated
using ((select public.current_profile_role()) = 'admin'::public.profile_role)
with check ((select public.current_profile_role()) = 'admin'::public.profile_role);