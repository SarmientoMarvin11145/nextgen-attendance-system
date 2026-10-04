alter table public.school_locations
  add column max_accuracy_meters integer not null default 50
    check (max_accuracy_meters > 0);

grant insert (max_accuracy_meters) on public.school_locations to authenticated;
grant update (max_accuracy_meters) on public.school_locations to authenticated;

alter table public.attendance_qr
  add column school_location_id uuid references public.school_locations (id) on delete restrict,
  add column location_verified boolean not null default false,
  add column distance_from_school numeric(10, 1),
  add column location_accuracy numeric(10, 1),
  add column location_verified_at timestamptz,
  add constraint attendance_qr_location_verification_complete
    check (not location_verified or (
      school_location_id is not null
      and distance_from_school is not null
      and distance_from_school >= 0
      and location_accuracy is not null
      and location_accuracy >= 0
      and location_verified_at is not null
    ));

alter table public.attendance_records
  add column school_location_id uuid references public.school_locations (id) on delete restrict,
  add column location_verified boolean not null default false,
  add column distance_from_school numeric(10, 1),
  add column location_accuracy numeric(10, 1),
  add column location_verified_at timestamptz,
  add constraint attendance_records_location_verification_complete
    check (not location_verified or (
      school_location_id is not null
      and distance_from_school is not null
      and distance_from_school >= 0
      and location_accuracy is not null
      and location_accuracy >= 0
      and location_verified_at is not null
    ));

update public.attendance_qr
set status = 'revoked'
where status = 'active';

drop function public.issue_attendance_qr(uuid);

create function public.issue_attendance_qr(
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

  if p_latitude is null or p_latitude not between -90 and 90
     or p_longitude is null or p_longitude not between -180 and 180
      or p_accuracy is null or p_accuracy < 0
      or p_accuracy::text in ('NaN', 'Infinity', '-Infinity') then
    return jsonb_build_object('status', 'invalid_location');
  end if;

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
    return jsonb_build_object('status', 'location_unavailable');
  end if;

  if p_accuracy > v_max_accuracy_meters then
    return jsonb_build_object(
      'status', 'accuracy_too_low',
      'accuracy', round(p_accuracy::numeric, 1),
      'maximum_accuracy', v_max_accuracy_meters
    );
  end if;

  if v_distance > v_radius_meters then
    return jsonb_build_object(
      'status', 'outside_area',
      'distance', round(v_distance::numeric, 1),
      'required_radius', v_radius_meters
    );
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
    v_school_location_id,
    true,
    round(v_distance::numeric, 1),
    round(p_accuracy::numeric, 1),
    v_now
  );

  return jsonb_build_object(
    'status', 'issued',
    'token', v_token,
    'expires_at', v_expires_at,
    'distance', round(v_distance::numeric, 1),
    'accuracy', round(p_accuracy::numeric, 1),
    'required_radius', v_radius_meters
  );
end;
$$;

revoke all on function public.issue_attendance_qr(uuid, double precision, double precision, double precision) from public, anon;
grant execute on function public.issue_attendance_qr(uuid, double precision, double precision, double precision) to authenticated;

create or replace function public.apply_qr_location_verification()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_location_verification record;
begin
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

  if not found or not v_location_verification.location_verified then
    raise exception using errcode = '42501', message = 'A valid location verification is required';
  end if;

  new.school_location_id := v_location_verification.school_location_id;
  new.location_verified := true;
  new.distance_from_school := v_location_verification.distance_from_school;
  new.location_accuracy := v_location_verification.location_accuracy;
  new.location_verified_at := v_location_verification.location_verified_at;
  return new;
end;
$$;

revoke all on function public.apply_qr_location_verification() from public, anon, authenticated;

create trigger attendance_records_apply_qr_location_verification
before insert on public.attendance_records
for each row execute function public.apply_qr_location_verification();