alter table public.attendance_sessions
  add column course_filter text,
  add column year_filter text,
  add column block_filter text,
  add column team_filter text,
  add constraint attendance_sessions_course_filter_length
    check (course_filter is null or length(trim(course_filter)) between 1 and 120),
  add constraint attendance_sessions_year_filter_length
    check (year_filter is null or length(trim(year_filter)) between 1 and 40),
  add constraint attendance_sessions_block_filter_length
    check (block_filter is null or length(trim(block_filter)) between 1 and 60),
  add constraint attendance_sessions_team_filter_length
    check (team_filter is null or length(trim(team_filter)) between 1 and 60);

drop function public.issue_attendance_qr(uuid);

create function public.issue_attendance_qr(p_session_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now timestamptz := clock_timestamp();
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_session_status public.attendance_session_status;
  v_course_filter text;
  v_year_filter text;
  v_block_filter text;
  v_team_filter text;
  v_course text;
  v_year text;
  v_block text;
  v_team text;
  v_token text;
  v_expires_at timestamptz;
  v_recent_count bigint;
  v_last_issued_at timestamptz;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  if (select public.current_profile_role()) is distinct from 'student'::public.profile_role then
    raise exception using errcode = '42501', message = 'Only students can request an attendance QR';
  end if;

  select session.start_time, session.end_time, session.status,
         session.course_filter, session.year_filter, session.block_filter, session.team_filter
  into v_start_time, v_end_time, v_session_status,
       v_course_filter, v_year_filter, v_block_filter, v_team_filter
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

  select profile.course, profile.year, profile.block, profile.team
  into v_course, v_year, v_block, v_team
  from public.profiles as profile
  where profile.id = (select auth.uid());

  if (v_course_filter is not null and lower(trim(coalesce(v_course, ''))) <> lower(trim(v_course_filter)))
     or (v_year_filter is not null and lower(trim(coalesce(v_year, ''))) <> lower(trim(v_year_filter)))
     or (v_block_filter is not null and lower(trim(coalesce(v_block, ''))) <> lower(trim(v_block_filter)))
     or (v_team_filter is not null and lower(trim(coalesce(v_team, ''))) <> lower(trim(v_team_filter))) then
    raise exception using errcode = '42501', message = 'Student is not eligible for this attendance session';
  end if;

  if exists (
    select 1
    from public.attendance_records as record
    where record.session_id = p_session_id
      and record.student_id = (select auth.uid())
  ) then
    raise exception using errcode = '23505', message = 'Attendance is already recorded for this session';
  end if;

  select count(*), max(qr.created_at)
  into v_recent_count, v_last_issued_at
  from public.attendance_qr as qr
  where qr.student_id = (select auth.uid())
    and qr.session_id = p_session_id
    and qr.created_at >= v_now - interval '15 minutes';

  if v_recent_count >= 3
     or (v_last_issued_at is not null and v_last_issued_at > v_now - interval '10 seconds') then
    raise exception using errcode = 'P0001', message = 'QR request limit reached. Wait before requesting another code.';
  end if;

  update public.attendance_qr
  set status = 'revoked'
  where student_id = (select auth.uid())
    and session_id = p_session_id
    and status = 'active';

  v_token := encode(extensions.gen_random_bytes(32), 'hex');
  v_expires_at := least(v_now + interval '5 minutes', v_end_time);

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
    v_expires_at
  );

  return jsonb_build_object('token', v_token, 'expires_at', v_expires_at);
end;
$$;

revoke all on function public.issue_attendance_qr(uuid) from public, anon;
grant execute on function public.issue_attendance_qr(uuid) to authenticated;

create or replace function public.enforce_attendance_session_audience()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_course_filter text;
  v_year_filter text;
  v_block_filter text;
  v_team_filter text;
  v_course text;
  v_year text;
  v_block text;
  v_team text;
begin
  select session.course_filter, session.year_filter, session.block_filter, session.team_filter
  into v_course_filter, v_year_filter, v_block_filter, v_team_filter
  from public.attendance_sessions as session
  where session.id = new.session_id;

  select profile.course, profile.year, profile.block, profile.team
  into v_course, v_year, v_block, v_team
  from public.profiles as profile
  where profile.id = new.student_id;

  if (v_course_filter is not null and lower(trim(coalesce(v_course, ''))) <> lower(trim(v_course_filter)))
     or (v_year_filter is not null and lower(trim(coalesce(v_year, ''))) <> lower(trim(v_year_filter)))
     or (v_block_filter is not null and lower(trim(coalesce(v_block, ''))) <> lower(trim(v_block_filter)))
     or (v_team_filter is not null and lower(trim(coalesce(v_team, ''))) <> lower(trim(v_team_filter))) then
    raise exception using errcode = '42501', message = 'Student is not eligible for this attendance session';
  end if;

  return new;
end;
$$;

revoke all on function public.enforce_attendance_session_audience() from public, anon, authenticated;

create trigger attendance_records_check_session_audience
before insert on public.attendance_records
for each row execute function public.enforce_attendance_session_audience();