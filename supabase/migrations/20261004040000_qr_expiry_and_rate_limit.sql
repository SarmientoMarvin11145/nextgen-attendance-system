drop function public.issue_attendance_qr(uuid);

create index attendance_qr_student_session_created_idx
  on public.attendance_qr (student_id, session_id, created_at desc);

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

  select session.start_time, session.end_time, session.status
  into v_start_time, v_end_time, v_session_status
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