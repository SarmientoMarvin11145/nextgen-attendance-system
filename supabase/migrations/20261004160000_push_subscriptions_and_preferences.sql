create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.profiles (id) on delete cascade,
  endpoint text not null unique check (length(endpoint) between 1 and 2048),
  p256dh text not null check (length(p256dh) between 1 and 256),
  auth text not null check (length(auth) between 1 and 256),
  device_name text not null default 'Browser device' check (length(trim(device_name)) between 1 and 120),
  user_agent text not null default '' check (length(user_agent) <= 1024),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_used_at timestamptz
);

create index push_subscriptions_user_active_idx
  on public.push_subscriptions (user_id, created_at desc)
  where is_active;

create trigger push_subscriptions_set_updated_at
before update on public.push_subscriptions
for each row execute function public.set_updated_at();

alter table public.push_subscriptions enable row level security;
revoke all on table public.push_subscriptions from anon, authenticated;
grant select (id, user_id, endpoint, device_name, user_agent, is_active, created_at, last_used_at)
  on public.push_subscriptions to authenticated;
grant insert (user_id, endpoint, p256dh, auth, device_name, user_agent, is_active)
  on public.push_subscriptions to authenticated;
grant update (endpoint, p256dh, auth, device_name, user_agent, is_active, last_used_at)
  on public.push_subscriptions to authenticated;
grant delete on public.push_subscriptions to authenticated;
grant select, update on public.push_subscriptions to service_role;

create policy push_subscriptions_read_own
on public.push_subscriptions for select to authenticated
using (user_id = (select auth.uid()));

create policy push_subscriptions_insert_own
on public.push_subscriptions for insert to authenticated
with check (user_id = (select auth.uid()));

create policy push_subscriptions_update_own
on public.push_subscriptions for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

create policy push_subscriptions_delete_own
on public.push_subscriptions for delete to authenticated
using (user_id = (select auth.uid()));

create table public.notification_preferences (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  attendance_open boolean not null default true,
  attendance_reminder boolean not null default true,
  attendance_closing boolean not null default true,
  attendance_recorded boolean not null default true,
  system_notifications boolean not null default true,
  updated_at timestamptz not null default now()
);

create trigger notification_preferences_set_updated_at
before update on public.notification_preferences
for each row execute function public.set_updated_at();

alter table public.notification_preferences enable row level security;
revoke all on table public.notification_preferences from anon, authenticated;
grant select, insert, update on public.notification_preferences to authenticated;

create policy notification_preferences_read_own
on public.notification_preferences for select to authenticated
using (user_id = (select auth.uid()));

create policy notification_preferences_insert_own
on public.notification_preferences for insert to authenticated
with check (user_id = (select auth.uid()));

create policy notification_preferences_update_own
on public.notification_preferences for update to authenticated
using (user_id = (select auth.uid()))
with check (user_id = (select auth.uid()));

alter table public.notifications
  add column push_sent_at timestamptz,
  add column push_claimed_at timestamptz,
  add column push_attempts integer not null default 0 check (push_attempts >= 0),
  add column push_last_error text;

grant update (push_sent_at, push_claimed_at, push_attempts, push_last_error)
  on public.notifications to service_role;

create or replace function public.claim_notification_push_batch(p_limit integer default 25)
returns table (
  notification_id uuid,
  title text,
  message text,
  attendance_session_id uuid,
  recipient_role public.profile_role,
  subscription_id uuid,
  endpoint text,
  p256dh text,
  auth text
)
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) is distinct from 'service_role' then
    raise exception using errcode = '42501', message = 'Service role required';
  end if;

  return query
  with candidates as (
    select notification.id
    from public.notifications as notification
    left join public.notification_preferences as preference
      on preference.user_id = notification.user_id
    where notification.push_sent_at is null
      and notification.push_attempts < 6
      and (notification.push_claimed_at is null
        or notification.push_claimed_at < clock_timestamp() - interval '10 minutes')
      and case
        when notification.event_key like '%:reminder' then coalesce(preference.attendance_reminder, true)
        when notification.event_key like '%:closing' or notification.event_key like '%:ended'
          then coalesce(preference.attendance_closing, true)
        when notification.type = 'attendance_opened'::public.notification_type
          then coalesce(preference.attendance_open, true)
        when notification.type = 'attendance_registered'::public.notification_type
          then coalesce(preference.attendance_recorded, true)
        else coalesce(preference.system_notifications, true)
      end
      and exists (
        select 1
        from public.push_subscriptions as subscription
        where subscription.user_id = notification.user_id
          and subscription.is_active
          and subscription.created_at <= notification.created_at
          and (preference.user_id is null or preference.updated_at <= notification.created_at)
      )
    order by notification.created_at
    for update of notification skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
  ), claimed as (
    update public.notifications as notification
    set push_claimed_at = clock_timestamp(),
        push_attempts = notification.push_attempts + 1,
        push_last_error = null
    from candidates
    where notification.id = candidates.id
        returning notification.id, notification.user_id, notification.title, notification.message,
              notification.attendance_session_id, notification.created_at
  )
  select claimed.id,
         claimed.title,
         claimed.message,
          claimed.attendance_session_id,
         recipient.role,
         subscription.id,
         subscription.endpoint,
         subscription.p256dh,
         subscription.auth
  from claimed
  join public.profiles as recipient on recipient.id = claimed.user_id
  join public.push_subscriptions as subscription
    on subscription.user_id = claimed.user_id
    and subscription.is_active
    and subscription.created_at <= claimed.created_at
  left join public.notification_preferences as preference
    on preference.user_id = claimed.user_id
  where case
    when exists (
      select 1 from public.notifications as notification
      where notification.id = claimed.id and notification.event_key like '%:reminder'
    ) then coalesce(preference.attendance_reminder, true)
    when exists (
      select 1 from public.notifications as notification
      where notification.id = claimed.id and (notification.event_key like '%:closing' or notification.event_key like '%:ended')
    ) then coalesce(preference.attendance_closing, true)
    when exists (
      select 1 from public.notifications as notification
      where notification.id = claimed.id and notification.type = 'attendance_opened'::public.notification_type
    ) then coalesce(preference.attendance_open, true)
    when exists (
      select 1 from public.notifications as notification
      where notification.id = claimed.id and notification.type = 'attendance_registered'::public.notification_type
    ) then coalesce(preference.attendance_recorded, true)
    else coalesce(preference.system_notifications, true)
  end
    and (preference.user_id is null or preference.updated_at <= claimed.created_at);
end;
$$;

revoke all on function public.claim_notification_push_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_push_batch(integer) to service_role;

create or replace function public.process_attendance_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  insert into public.notifications (user_id, title, message, type, attendance_session_id, event_key)
  select profile.id,
         'Attendance has started',
         'Registration is open for "' || session.title || '".',
         'attendance_opened'::public.notification_type,
         session.id,
         'session:' || session.id::text || ':started'
  from public.attendance_sessions as session
  join public.profiles as profile on profile.role = 'student'::public.profile_role
    and profile.status = 'active'::public.profile_status
    and (session.course_filter is null or lower(trim(coalesce(profile.course, ''))) = lower(trim(session.course_filter)))
    and (session.year_filter is null or lower(trim(coalesce(profile.year, ''))) = lower(trim(session.year_filter)))
    and (session.block_filter is null or lower(trim(coalesce(profile.block, ''))) = lower(trim(session.block_filter)))
    and (session.team_filter is null or lower(trim(coalesce(profile.team, ''))) = lower(trim(session.team_filter)))
  where session.status = 'open'::public.attendance_session_status
    and session.start_time <= v_now
    and session.end_time > v_now
  on conflict (user_id, event_key) where event_key is not null do nothing;

  insert into public.notifications (user_id, title, message, type, attendance_session_id, event_key)
  select profile.id,
         'Attendance reminder',
         'Registration for "' || session.title || '" closes in 15 minutes or less.',
         'system'::public.notification_type,
         session.id,
         'session:' || session.id::text || ':reminder'
  from public.attendance_sessions as session
  join public.profiles as profile on profile.role = 'student'::public.profile_role
    and profile.status = 'active'::public.profile_status
    and (session.course_filter is null or lower(trim(coalesce(profile.course, ''))) = lower(trim(session.course_filter)))
    and (session.year_filter is null or lower(trim(coalesce(profile.year, ''))) = lower(trim(session.year_filter)))
    and (session.block_filter is null or lower(trim(coalesce(profile.block, ''))) = lower(trim(session.block_filter)))
    and (session.team_filter is null or lower(trim(coalesce(profile.team, ''))) = lower(trim(session.team_filter)))
  where session.status = 'open'::public.attendance_session_status
    and session.start_time <= v_now
    and session.end_time > v_now + interval '10 minutes'
    and session.end_time <= v_now + interval '15 minutes'
  on conflict (user_id, event_key) where event_key is not null do nothing;

  insert into public.notifications (user_id, title, message, type, attendance_session_id, event_key)
  select profile.id,
         'Attendance closing soon',
         'Registration for "' || session.title || '" closes in 10 minutes or less.',
         'system'::public.notification_type,
         session.id,
         'session:' || session.id::text || ':closing'
  from public.attendance_sessions as session
  join public.profiles as profile on profile.role = 'student'::public.profile_role
    and profile.status = 'active'::public.profile_status
    and (session.course_filter is null or lower(trim(coalesce(profile.course, ''))) = lower(trim(session.course_filter)))
    and (session.year_filter is null or lower(trim(coalesce(profile.year, ''))) = lower(trim(session.year_filter)))
    and (session.block_filter is null or lower(trim(coalesce(profile.block, ''))) = lower(trim(session.block_filter)))
    and (session.team_filter is null or lower(trim(coalesce(profile.team, ''))) = lower(trim(session.team_filter)))
  where session.status = 'open'::public.attendance_session_status
    and session.start_time <= v_now
    and session.end_time > v_now
    and session.end_time <= v_now + interval '10 minutes'
  on conflict (user_id, event_key) where event_key is not null do nothing;

  insert into public.notifications (user_id, title, message, type, attendance_session_id, event_key)
  select profile.id,
         'Attendance has ended',
         'The attendance window for "' || session.title || '" has ended.',
         'attendance_completed'::public.notification_type,
         session.id,
         'session:' || session.id::text || ':ended'
  from public.attendance_sessions as session
  join public.profiles as profile on profile.role = 'student'::public.profile_role
    and profile.status = 'active'::public.profile_status
    and (session.course_filter is null or lower(trim(coalesce(profile.course, ''))) = lower(trim(session.course_filter)))
    and (session.year_filter is null or lower(trim(coalesce(profile.year, ''))) = lower(trim(session.year_filter)))
    and (session.block_filter is null or lower(trim(coalesce(profile.block, ''))) = lower(trim(session.block_filter)))
    and (session.team_filter is null or lower(trim(coalesce(profile.team, ''))) = lower(trim(session.team_filter)))
  where session.status = 'open'::public.attendance_session_status
    and session.end_time <= v_now
  on conflict (user_id, event_key) where event_key is not null do nothing;
end;
$$;