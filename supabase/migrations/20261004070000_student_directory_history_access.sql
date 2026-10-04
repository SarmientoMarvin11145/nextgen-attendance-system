create type public.profile_status as enum ('active', 'inactive');

alter table public.profiles
  add column status public.profile_status not null default 'active';

grant select (email, status) on public.profiles to authenticated;