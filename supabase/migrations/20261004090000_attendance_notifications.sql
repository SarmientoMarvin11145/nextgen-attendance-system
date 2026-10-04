create extension if not exists pg_cron;

alter table public.notifications
  add column attendance_session_id uuid references public.attendance_sessions (id) on delete cascade,
  add column event_key text;

create unique index notifications_user_event_key_unique
  on public.notifications (user_id, event_key)
  where event_key is not null;

create or replace function public.notify_attendance_session_created()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.notifications (
    user_id,
    title,
    message,
    type,
    attendance_session_id,
    event_key
  )
  values (
    new.created_by,
    'Attendance successfully created',
    '"' || new.title || '" is ready for its scheduled attendance window.',
    'attendance_opened'::public.notification_type,
    new.id,
    'session:' || new.id::text || ':created'
  )
  on conflict (user_id, event_key) where event_key is not null do nothing;

  return new;
end;
$$;

create trigger attendance_sessions_notify_creator
after insert on public.attendance_sessions
for each row execute function public.notify_attendance_session_created();

create or replace function public.notify_attendance_recorded()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_created_by uuid;
  v_session_title text;
begin
  select session.created_by, session.title
  into v_created_by, v_session_title
  from public.attendance_sessions as session
  where session.id = new.session_id;

  if v_created_by is not null then
    insert into public.notifications (
      user_id,
      title,
      message,
      type,
      attendance_session_id,
      event_key
    )
    values (
      v_created_by,
      'Student attendance recorded',
      'A student registered for "' || v_session_title || '".',
      'attendance_registered'::public.notification_type,
      new.session_id,
      'attendance:' || new.id::text || ':officer'
    )
    on conflict (user_id, event_key) where event_key is not null do nothing;
  end if;

  insert into public.notifications (
    user_id,
    title,
    message,
    type,
    attendance_session_id,
    event_key
  )
  values (
    new.student_id,
    'Attendance recorded',
    'Your attendance for "' || coalesce(v_session_title, 'the session') || '" was recorded.',
    'attendance_registered'::public.notification_type,
    new.session_id,
    'attendance:' || new.id::text || ':student'
  )
  on conflict (user_id, event_key) where event_key is not null do nothing;

  return new;
end;
$$;

create trigger attendance_records_notify_participants
after insert on public.attendance_records
for each row execute function public.notify_attendance_recorded();

create or replace function public.process_attendance_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
begin
  insert into public.notifications (
    user_id,
    title,
    message,
    type,
    attendance_session_id,
    event_key
  )
  select
    profile.id,
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

  insert into public.notifications (
    user_id,
    title,
    message,
    type,
    attendance_session_id,
    event_key
  )
  select
    profile.id,
    'Attendance is about to expire',
    'Registration for "' || session.title || '" closes in 15 minutes or less.',
    'system'::public.notification_type,
    session.id,
    'session:' || session.id::text || ':expiring'
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
    and session.end_time <= v_now + interval '15 minutes'
  on conflict (user_id, event_key) where event_key is not null do nothing;

  insert into public.notifications (
    user_id,
    title,
    message,
    type,
    attendance_session_id,
    event_key
  )
  select
    profile.id,
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

revoke all on function public.notify_attendance_session_created() from public, anon, authenticated;
revoke all on function public.notify_attendance_recorded() from public, anon, authenticated;
revoke all on function public.process_attendance_notifications() from public, anon, authenticated;

select cron.schedule(
  'attendance-session-notifications',
  '* * * * *',
  'select public.process_attendance_notifications();'
);