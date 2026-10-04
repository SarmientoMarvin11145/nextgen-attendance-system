create or replace function public.format_attendance_notification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_session_title text;
  v_record_id text;
  v_registered_at timestamptz;
  v_attendance_status public.attendance_status;
  v_school_timezone text;
  v_notify_after_attendance boolean;
begin
  if new.attendance_session_id is null then
    return new;
  end if;

  select settings.school_timezone, settings.notify_after_attendance
  into v_school_timezone, v_notify_after_attendance
  from public.application_settings as settings
  where settings.id = true;
  v_school_timezone := coalesce(v_school_timezone, 'Asia/Manila');

  select session.title
  into v_session_title
  from public.attendance_sessions as session
  where session.id = new.attendance_session_id;

  if new.event_key like '%:started' then
    new.title := 'Attendance Open';
    new.message := '"' || coalesce(v_session_title, 'Attendance session') || '" is now available. Tap to register attendance.';
  elsif new.event_key like '%:reminder' then
    new.title := 'Attendance Reminder';
    new.message := '"' || coalesce(v_session_title, 'Attendance session') || '" will close soon.';
  elsif new.event_key like '%:closing' then
    new.title := 'Attendance Ending Soon';
    new.message := 'Only 5 minutes or less remain to register for "' || coalesce(v_session_title, 'Attendance session') || '".';
  elsif new.event_key like '%:student' and new.event_key like 'attendance:%' then
    if not coalesce(v_notify_after_attendance, true) then
      return null;
    end if;

    v_record_id := split_part(new.event_key, ':', 2);
    if v_record_id ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$' then
      select record.registered_at, record.attendance_status
      into v_registered_at, v_attendance_status
      from public.attendance_records as record
      where record.id = v_record_id::uuid
        and record.student_id = new.user_id;
    end if;

    if v_registered_at is not null then
      new.title := 'Attendance Confirmed';
      new.message := 'Your attendance for "' || coalesce(v_session_title, 'the session')
        || '" was successfully recorded at '
        || to_char(v_registered_at at time zone v_school_timezone, 'FMHH12:MI AM')
        || ' ' || v_school_timezone || '. Status: ' || upper(v_attendance_status::text) || '.';
    end if;
  end if;

  return new;
end;
$$;

create or replace function public.process_attendance_notifications()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_notify_open boolean;
  v_notify_reminder boolean;
  v_notify_closing boolean;
  v_reminder_minutes integer;
begin
  select settings.notify_attendance_open,
         settings.notify_attendance_reminder,
         settings.notify_attendance_closing,
         settings.reminder_minutes_before_close
  into v_notify_open, v_notify_reminder, v_notify_closing, v_reminder_minutes
  from public.application_settings as settings
  where settings.id = true;

  if not found then
    v_notify_open := true;
    v_notify_reminder := true;
    v_notify_closing := true;
    v_reminder_minutes := 10;
  end if;

  if v_notify_open then
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
  end if;

  if v_notify_reminder then
    insert into public.notifications (user_id, title, message, type, attendance_session_id, event_key)
    select profile.id,
           'Attendance reminder',
           'Registration for "' || session.title || '" closes soon.',
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
      and session.end_time > v_now + interval '5 minutes'
      and session.end_time <= v_now + make_interval(mins => v_reminder_minutes)
    on conflict (user_id, event_key) where event_key is not null do nothing;
  end if;

  if v_notify_closing then
    insert into public.notifications (user_id, title, message, type, attendance_session_id, event_key)
    select profile.id,
           'Attendance closing soon',
           'Registration for "' || session.title || '" closes in 5 minutes or less.',
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
      and session.end_time <= v_now + interval '5 minutes'
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
  end if;
end;
$$;