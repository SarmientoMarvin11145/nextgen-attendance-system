drop function public.register_attendance_from_qr(text);

create function public.register_attendance_from_qr(p_token text)
returns jsonb
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
  v_student_role public.profile_role;
  v_qr_status public.attendance_qr_status;
  v_expires_at timestamptz;
  v_start_time timestamptz;
  v_end_time timestamptz;
  v_late_after timestamptz;
  v_session_title text;
  v_session_status public.attendance_session_status;
  v_record_id uuid;
  v_registered_at timestamptz;
  v_attendance_status public.attendance_status;
  v_first_name text;
  v_last_name text;
  v_course text;
  v_year text;
  v_block text;
  v_team text;
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

  if not found then
    raise exception using errcode = '22023', message = 'Invalid or expired QR code';
  end if;

  select session.start_time, session.end_time, session.late_after, session.title, session.status
  into v_start_time, v_end_time, v_late_after, v_session_title, v_session_status
  from public.attendance_sessions as session
  where session.id = v_session_id;

  if v_session_status <> 'open'
     or v_now < v_start_time
     or v_now >= v_end_time then
    raise exception using errcode = '22023', message = 'Attendance session is not accepting registrations';
  end if;

  select profile.role, profile.first_name, profile.last_name, profile.course, profile.year, profile.block, profile.team
  into v_student_role, v_first_name, v_last_name, v_course, v_year, v_block, v_team
  from public.profiles as profile
  where profile.id = v_student_id;

  if not found or v_student_role is distinct from 'student'::public.profile_role then
    raise exception using errcode = '22023', message = 'Invalid or expired QR code';
  end if;

  if v_qr_status = 'used' and v_expires_at > v_now then
    select record.id, record.registered_at, record.attendance_status
    into v_record_id, v_registered_at, v_attendance_status
    from public.attendance_records as record
    where record.session_id = v_session_id
      and record.student_id = v_student_id;

    if found then
      return jsonb_build_object(
        'result', 'already_recorded',
        'first_name', v_first_name,
        'last_name', v_last_name,
        'course', v_course,
        'year', v_year,
        'block', v_block,
        'team', v_team,
        'attendance_status', v_attendance_status,
        'registered_at', v_registered_at
      );
    end if;
  end if;

  if v_qr_status <> 'active' or v_expires_at <= v_now then
    raise exception using errcode = '22023', message = 'Invalid or expired QR code';
  end if;

  select record.id, record.registered_at, record.attendance_status
  into v_record_id, v_registered_at, v_attendance_status
  from public.attendance_records as record
  where record.session_id = v_session_id
    and record.student_id = v_student_id;

  if found then
    update public.attendance_qr
    set status = 'used', used_at = v_now
    where id = v_qr_id;

    return jsonb_build_object(
      'result', 'already_recorded',
      'first_name', v_first_name,
      'last_name', v_last_name,
      'course', v_course,
      'year', v_year,
      'block', v_block,
      'team', v_team,
      'attendance_status', v_attendance_status,
      'registered_at', v_registered_at
    );
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
  returning id, registered_at into v_record_id, v_registered_at;

  update public.attendance_qr
  set status = 'used', used_at = v_now
  where id = v_qr_id;

  return jsonb_build_object(
    'result', 'recorded',
    'session_title', v_session_title,
    'first_name', v_first_name,
    'last_name', v_last_name,
    'course', v_course,
    'year', v_year,
    'block', v_block,
    'team', v_team,
    'attendance_status', v_attendance_status,
    'registered_at', v_registered_at
  );
end;
$$;

revoke all on function public.register_attendance_from_qr(text) from public, anon;
grant execute on function public.register_attendance_from_qr(text) to authenticated;