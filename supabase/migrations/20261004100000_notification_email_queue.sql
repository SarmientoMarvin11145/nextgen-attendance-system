alter table public.notifications
  add column email_sent_at timestamptz,
  add column email_claimed_at timestamptz,
  add column email_attempts integer not null default 0 check (email_attempts >= 0),
  add column email_last_error text;

revoke select on table public.notifications from authenticated;
grant select (
  id, user_id, title, message, type, is_read, created_at, attendance_session_id, event_key
) on public.notifications to authenticated;

create or replace function public.claim_notification_email_batch(p_limit integer default 25)
returns table (
  notification_id uuid,
  recipient_email text,
  title text,
  message text,
  event_type public.notification_type
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
    join public.profiles as profile on profile.id = notification.user_id
    where notification.email_sent_at is null
      and notification.email_attempts < 6
      and (notification.email_claimed_at is null
        or notification.email_claimed_at < clock_timestamp() - interval '10 minutes')
      and profile.status = 'active'::public.profile_status
      and profile.email is not null
      and length(trim(profile.email)) > 0
    order by notification.created_at
    for update of notification skip locked
    limit least(greatest(coalesce(p_limit, 25), 1), 100)
  ), claimed as (
    update public.notifications as notification
    set email_claimed_at = clock_timestamp(),
        email_attempts = notification.email_attempts + 1,
        email_last_error = null
    from candidates
    where notification.id = candidates.id
    returning notification.id, notification.user_id, notification.title, notification.message, notification.type
  )
  select claimed.id,
         profile.email,
         claimed.title,
         claimed.message,
         claimed.type
  from claimed
  join public.profiles as profile on profile.id = claimed.user_id;
end;
$$;

revoke all on function public.claim_notification_email_batch(integer) from public, anon, authenticated;
grant execute on function public.claim_notification_email_batch(integer) to service_role;