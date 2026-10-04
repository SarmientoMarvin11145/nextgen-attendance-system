alter table public.attendance_sessions
  add column location_requirement text not null default 'required'
    check (location_requirement in ('required', 'optional', 'disabled'));

alter table public.attendance_records
  add column verification_method text;

update public.attendance_records
set verification_method = case
  when location_verified then 'QR + LOCATION + SESSION'
  else 'QR + SESSION'
end;

alter table public.attendance_records
  alter column verification_method set default 'QR + SESSION',
  alter column verification_method set not null,
  add constraint attendance_records_verification_method_valid
    check (verification_method in ('QR', 'QR + SESSION', 'QR + LOCATION', 'QR + LOCATION + SESSION'));

create or replace function public.issue_attendance_qr(
  p_session_id uuid,
  p_latitude double precision,
  p_longitude double precision,
  p_accuracy double precision
)
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
  v_location_requirement text;
  v_course_filter text;
  v_year_filter text;
  v_block_filter text;
  v_team_filter text;
  v_course text;
  v_year text;
  v_block text;
  v_team text;
  v_school_location_id uuid;
  v_radius_meters integer;
  v_max_accuracy_meters integer;
  v_distance double precision;
  v_location_verified boolean := false;
  v_location_reason text;
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
         session.location_requirement, session.course_filter, session.year_filter,
         session.block_filter, session.team_filter
  into v_start_time, v_end_time, v_session_status, v_location_requirement,
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

  if v_location_requirement = 'disabled' then
    v_location_reason := 'location_disabled';
  elsif p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180
     or p_accuracy is null or p_accuracy < 0
     or p_accuracy::text in ('NaN', 'Infinity', '-Infinity') then
    if v_location_requirement = 'required' then
      return jsonb_build_object('status', 'invalid_location');
    end if;
    v_location_reason := 'location_not_provided';
  else
    select candidate.id, candidate.radius_meters, candidate.max_accuracy_meters, candidate.distance_meters
    into v_school_location_id, v_radius_meters, v_max_accuracy_meters, v_distance
    from (
      select location.id,
             location.radius_meters,
             location.max_accuracy_meters,
             6371000 * 2 * asin(sqrt(least(1.0,
               power(sin(radians(location.latitude::double precision - p_latitude) / 2), 2)
               + cos(radians(p_latitude)) * cos(radians(location.latitude::double precision))
               * power(sin(radians(location.longitude::double precision - p_longitude) / 2), 2)
             ))) as distance_meters
      from public.school_locations as location
      where location.is_active
    ) as candidate
    order by candidate.distance_meters
    limit 1;

    if not found then
      if v_location_requirement = 'required' then
        return jsonb_build_object('status', 'location_unavailable');
      end if;
      v_location_reason := 'location_unavailable';
    elsif p_accuracy > v_max_accuracy_meters then
      if v_location_requirement = 'required' then
        return jsonb_build_object(
          'status', 'accuracy_too_low',
          'accuracy', round(p_accuracy::numeric, 1),
          'maximum_accuracy', v_max_accuracy_meters
        );
      end if;
      v_location_reason := 'accuracy_too_low';
    elsif v_distance > v_radius_meters then
      if v_location_requirement = 'required' then
        return jsonb_build_object(
          'status', 'outside_area',
          'distance', round(v_distance::numeric, 1),
          'required_radius', v_radius_meters
        );
      end if;
      v_location_reason := 'outside_area';
    else
      v_location_verified := true;
    end if;
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
    expires_at,
    school_location_id,
    location_verified,
    distance_from_school,
    location_accuracy,
    location_verified_at
  )
  values (
    (select auth.uid()),
    p_session_id,
    extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'),
    v_expires_at,
    case when v_location_verified then v_school_location_id end,
    v_location_verified,
    case when v_location_verified then round(v_distance::numeric, 1) end,
    case when v_location_verified then round(p_accuracy::numeric, 1) end,
    case when v_location_verified then v_now end
  );

  return jsonb_build_object(
    'status', case when v_location_verified then 'issued' else 'issued_unverified' end,
    'reason', v_location_reason,
    'token', v_token,
    'expires_at', v_expires_at,
    'distance', case when v_distance is not null then round(v_distance::numeric, 1) end,
    'accuracy', case when p_accuracy is not null and p_accuracy::text not in ('NaN', 'Infinity', '-Infinity') then round(p_accuracy::numeric, 1) end,
    'required_radius', v_radius_meters,
    'maximum_accuracy', v_max_accuracy_meters
  );
end;
$$;

create or replace function public.apply_qr_location_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_requirement text;
  v_location_verification record;
begin
  select session.location_requirement
  into v_location_requirement
  from public.attendance_sessions as session
  where session.id = new.session_id;

  select qr.school_location_id,
         qr.location_verified,
         qr.distance_from_school,
         qr.location_accuracy,
         qr.location_verified_at
  into v_location_verification
  from public.attendance_qr as qr
  where qr.student_id = new.student_id
    and qr.session_id = new.session_id
    and qr.status = 'active'
    and qr.expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'A valid attendance QR is required';
  end if;

  if v_location_verification.location_verified then
    new.school_location_id := v_location_verification.school_location_id;
    new.location_verified := true;
    new.distance_from_school := v_location_verification.distance_from_school;
    new.location_accuracy := v_location_verification.location_accuracy;
    new.location_verified_at := v_location_verification.location_verified_at;
    new.verification_method := 'QR + LOCATION + SESSION';
  elsif v_location_requirement = 'required' then
    raise exception using errcode = '42501', message = 'Location verification is required for this attendance session';
  else
    new.school_location_id := null;
    new.location_verified := false;
    new.distance_from_school := null;
    new.location_accuracy := null;
    new.location_verified_at := null;
    new.verification_method := 'QR + SESSION';
  end if;

  return new;
end;
$$;