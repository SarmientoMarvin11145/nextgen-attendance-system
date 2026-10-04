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
  v_all_gates boolean;
  v_course_filter text;
  v_year_filter text;
  v_block_filter text;
  v_team_filter text;
  v_course text;
  v_year text;
  v_block text;
  v_team text;
  v_gate_id uuid;
  v_gate_code text;
  v_gate_name text;
  v_radius_meters integer;
  v_max_accuracy_meters integer;
  v_boundary_uncertainty_meters integer;
  v_distance double precision;
  v_nearest record;
  v_accuracy_eligible record;
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
         session.location_requirement, session.all_gates,
         session.course_filter, session.year_filter, session.block_filter, session.team_filter
  into v_start_time, v_end_time, v_session_status, v_location_requirement, v_all_gates,
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
    select candidate.id, candidate.code, candidate.name, candidate.radius_meters,
           candidate.max_accuracy_meters, candidate.boundary_uncertainty_meters,
           candidate.distance_meters
    into v_nearest
    from (
      select gate.id,
             gate.code,
             gate.name,
             gate.radius_meters,
             gate.max_accuracy_meters,
             gate.boundary_uncertainty_meters,
             6371000 * 2 * asin(sqrt(least(1.0,
               power(sin(radians(gate.latitude::double precision - p_latitude) / 2), 2)
               + cos(radians(p_latitude)) * cos(radians(gate.latitude::double precision))
               * power(sin(radians(gate.longitude::double precision - p_longitude) / 2), 2)
             ))) as distance_meters
      from public.attendance_gates as gate
      where gate.is_active
        and (
          (v_all_gates and not exists (
            select 1 from public.attendance_session_gates as session_gate
            where session_gate.session_id = p_session_id
              and session_gate.gate_id = gate.id
              and not session_gate.is_open
          ))
          or (not v_all_gates and exists (
            select 1 from public.attendance_session_gates as session_gate
            where session_gate.session_id = p_session_id
              and session_gate.gate_id = gate.id
              and session_gate.is_open
          ))
        )
    ) as candidate
    order by candidate.distance_meters, candidate.code
    limit 1;

    if not found then
      if v_location_requirement = 'required' then
        return jsonb_build_object('status', 'location_unavailable');
      end if;
      v_location_reason := 'location_unavailable';
    else
      select candidate.id, candidate.code, candidate.name, candidate.radius_meters,
             candidate.max_accuracy_meters, candidate.boundary_uncertainty_meters,
             candidate.distance_meters
      into v_accuracy_eligible
      from (
        select gate.id,
               gate.code,
               gate.name,
               gate.radius_meters,
               gate.max_accuracy_meters,
               gate.boundary_uncertainty_meters,
               6371000 * 2 * asin(sqrt(least(1.0,
                 power(sin(radians(gate.latitude::double precision - p_latitude) / 2), 2)
                 + cos(radians(p_latitude)) * cos(radians(gate.latitude::double precision))
                 * power(sin(radians(gate.longitude::double precision - p_longitude) / 2), 2)
               ))) as distance_meters
        from public.attendance_gates as gate
        where gate.is_active
          and p_accuracy <= gate.max_accuracy_meters
          and (
            (v_all_gates and not exists (
              select 1 from public.attendance_session_gates as session_gate
              where session_gate.session_id = p_session_id
                and session_gate.gate_id = gate.id
                and not session_gate.is_open
            ))
            or (not v_all_gates and exists (
              select 1 from public.attendance_session_gates as session_gate
              where session_gate.session_id = p_session_id
                and session_gate.gate_id = gate.id
                and session_gate.is_open
            ))
          )
      ) as candidate
      where candidate.distance_meters + p_accuracy + candidate.boundary_uncertainty_meters < candidate.radius_meters
      order by candidate.distance_meters, candidate.code
      limit 1;

      if found then
        v_gate_id := v_accuracy_eligible.id;
        v_gate_code := v_accuracy_eligible.code;
        v_gate_name := v_accuracy_eligible.name;
        v_radius_meters := v_accuracy_eligible.radius_meters;
        v_max_accuracy_meters := v_accuracy_eligible.max_accuracy_meters;
        v_boundary_uncertainty_meters := v_accuracy_eligible.boundary_uncertainty_meters;
        v_distance := v_accuracy_eligible.distance_meters;
        v_location_verified := true;
      else
        select candidate.id, candidate.code, candidate.name, candidate.radius_meters,
               candidate.max_accuracy_meters, candidate.boundary_uncertainty_meters,
               candidate.distance_meters
        into v_accuracy_eligible
        from (
          select gate.id,
                 gate.code,
                 gate.name,
                 gate.radius_meters,
                 gate.max_accuracy_meters,
                 gate.boundary_uncertainty_meters,
                 6371000 * 2 * asin(sqrt(least(1.0,
                   power(sin(radians(gate.latitude::double precision - p_latitude) / 2), 2)
                   + cos(radians(p_latitude)) * cos(radians(gate.latitude::double precision))
                   * power(sin(radians(gate.longitude::double precision - p_longitude) / 2), 2)
                 ))) as distance_meters
          from public.attendance_gates as gate
          where gate.is_active
            and p_accuracy <= gate.max_accuracy_meters
            and (
              (v_all_gates and not exists (
                select 1 from public.attendance_session_gates as session_gate
                where session_gate.session_id = p_session_id
                  and session_gate.gate_id = gate.id
                  and not session_gate.is_open
              ))
              or (not v_all_gates and exists (
                select 1 from public.attendance_session_gates as session_gate
                where session_gate.session_id = p_session_id
                  and session_gate.gate_id = gate.id
                  and session_gate.is_open
              ))
            )
        ) as candidate
        order by candidate.distance_meters, candidate.code
        limit 1;

        if not found then
          if v_location_requirement = 'required' then
            return jsonb_build_object(
              'status', 'accuracy_too_low',
              'accuracy', round(p_accuracy::numeric, 1),
              'maximum_accuracy', v_nearest.max_accuracy_meters
            );
          end if;
          v_location_reason := 'accuracy_too_low';
        else
          v_gate_id := v_accuracy_eligible.id;
          v_gate_code := v_accuracy_eligible.code;
          v_gate_name := v_accuracy_eligible.name;
          v_radius_meters := v_accuracy_eligible.radius_meters;
          v_max_accuracy_meters := v_accuracy_eligible.max_accuracy_meters;
          v_boundary_uncertainty_meters := v_accuracy_eligible.boundary_uncertainty_meters;
          v_distance := v_accuracy_eligible.distance_meters;

          if v_distance <= v_radius_meters then
            if v_location_requirement = 'required' then
              return jsonb_build_object(
                'status', 'location_uncertain',
                'gate_name', v_gate_name,
                'gate_code', v_gate_code,
                'distance', round(v_distance::numeric, 1),
                'required_radius', v_radius_meters
              );
            end if;
            v_location_reason := 'location_uncertain';
          else
            if v_location_requirement = 'required' then
              return jsonb_build_object(
                'status', 'outside_area',
                'gate_name', v_gate_name,
                'gate_code', v_gate_code,
                'distance', round(v_distance::numeric, 1),
                'required_radius', v_radius_meters
              );
            end if;
            v_location_reason := 'outside_area';
          end if;
        end if;
      end if;
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
    student_id, session_id, token_hash, expires_at, gate_id, location_verified,
    distance_from_school, location_accuracy, location_verified_at
  )
  values (
    (select auth.uid()), p_session_id,
    extensions.digest(convert_to(v_token, 'UTF8'), 'sha256'), v_expires_at,
    case when v_location_verified then v_gate_id end, v_location_verified,
    case when v_location_verified then round(v_distance::numeric, 1) end,
    case when v_location_verified then round(p_accuracy::numeric, 1) end,
    case when v_location_verified then v_now end
  );

  return jsonb_build_object(
    'status', case when v_location_verified then 'issued' else 'issued_unverified' end,
    'reason', v_location_reason,
    'token', v_token,
    'expires_at', v_expires_at,
    'gate_id', case when v_location_verified then v_gate_id end,
    'gate_name', case when v_location_verified then v_gate_name end,
    'gate_code', case when v_location_verified then v_gate_code end,
    'distance', case when v_distance is not null then round(v_distance::numeric, 1) end,
    'accuracy', case when p_accuracy is not null and p_accuracy::text not in ('NaN', 'Infinity', '-Infinity') then round(p_accuracy::numeric, 1) end,
    'required_radius', v_radius_meters,
    'maximum_accuracy', v_max_accuracy_meters
  );
end;
$$;

create or replace function public.enforce_attendance_qr_location_boundary()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_radius_meters integer;
  v_uncertainty_meters integer;
begin
  if not new.location_verified then
    return new;
  end if;

  select gate.radius_meters, gate.boundary_uncertainty_meters
  into v_radius_meters, v_uncertainty_meters
  from public.attendance_gates as gate
  where gate.id = new.gate_id
    and gate.is_active;

  if not found or new.distance_from_school + new.location_accuracy + v_uncertainty_meters >= v_radius_meters then
    raise exception using errcode = 'P0001', message = 'Location is uncertain near the attendance gate boundary';
  end if;

  return new;
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
  v_all_gates boolean;
  v_qr record;
  v_gate_id uuid;
  v_scan_gate_id uuid;
begin
  select session.location_requirement, session.all_gates
  into v_location_requirement, v_all_gates
  from public.attendance_sessions as session
  where session.id = new.session_id;

  select qr.gate_id, qr.location_verified, qr.distance_from_school,
         qr.location_accuracy, qr.location_verified_at
  into v_qr
  from public.attendance_qr as qr
  where qr.student_id = new.student_id
    and qr.session_id = new.session_id
    and qr.status = 'active'
    and qr.expires_at > clock_timestamp()
  for update;

  if not found then
    raise exception using errcode = '42501', message = 'A valid attendance QR is required';
  end if;

  v_scan_gate_id := nullif(current_setting('app.attendance_gate_id', true), '')::uuid;
  if v_qr.location_verified then
    v_gate_id := v_qr.gate_id;
    if v_scan_gate_id is distinct from v_gate_id then
      raise exception using errcode = '42501', message = 'Scanned gate does not match the verified attendance gate';
    end if;
  else
    if v_location_requirement = 'required' then
      raise exception using errcode = '42501', message = 'Location verification is required for this attendance session';
    end if;
    v_gate_id := v_scan_gate_id;
  end if;

  if v_gate_id is null or not exists (
    select 1
    from public.attendance_gates as gate
    where gate.id = v_gate_id
      and gate.is_active
  ) then
    raise exception using errcode = '42501', message = 'Attendance gate is not active';
  end if;

  if not v_all_gates and not exists (
    select 1
    from public.attendance_session_gates as session_gate
    where session_gate.session_id = new.session_id
      and session_gate.gate_id = v_gate_id
      and session_gate.is_open
  ) then
    raise exception using errcode = '42501', message = 'Attendance gate is closed for this session';
  end if;

  if v_all_gates and exists (
    select 1
    from public.attendance_session_gates as session_gate
    where session_gate.session_id = new.session_id
      and session_gate.gate_id = v_gate_id
      and not session_gate.is_open
  ) then
    raise exception using errcode = '42501', message = 'Attendance gate is closed for this session';
  end if;

  new.gate_id := v_gate_id;
  new.location_verified := v_qr.location_verified;
  new.distance_from_school := v_qr.distance_from_school;
  new.location_accuracy := v_qr.location_accuracy;
  new.location_verified_at := v_qr.location_verified_at;
  new.verification_method := case when v_qr.location_verified
    then 'QR + LOCATION + SESSION'
    else 'QR + SESSION'
  end;
  return new;
end;
$$;

create or replace function public.audit_verified_attendance_qr()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.location_verified then
    insert into public.audit_logs (user_id, action, entity_type, entity_id, metadata)
    values (
      new.student_id,
      'LOCATION_VERIFICATION_SUCCESS',
      'attendance_session',
      new.session_id,
      jsonb_build_object(
        'gate_id', new.gate_id,
        'distance_meters', new.distance_from_school,
        'location_accuracy', new.location_accuracy,
        'verified_at', new.location_verified_at
      )
    );
  end if;
  return new;
end;
$$;

alter function public.register_attendance_from_qr(text) rename to register_attendance_from_qr_base;
revoke all on function public.register_attendance_from_qr_base(text) from public, anon, authenticated;

create function public.register_attendance_from_qr(
  p_token text,
  p_expected_session_id uuid,
  p_gate_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor_role public.profile_role;
  v_qr record;
  v_gate record;
  v_result jsonb;
  v_record_gate_id uuid;
begin
  if (select auth.uid()) is null then
    raise exception using errcode = '42501', message = 'Authentication required';
  end if;

  v_actor_role := (select public.current_profile_role());
  if v_actor_role is distinct from 'officer'::public.profile_role
     and v_actor_role is distinct from 'admin'::public.profile_role then
    raise exception using errcode = '42501', message = 'Only officers can register QR attendance';
  end if;

  select qr.student_id, qr.session_id, qr.gate_id, qr.location_verified
  into v_qr
  from public.attendance_qr as qr
  where qr.token_hash = extensions.digest(convert_to(p_token, 'UTF8'), 'sha256');

  if not found then
    return public.register_attendance_from_qr_base(p_token);
  end if;

  if v_qr.session_id <> p_expected_session_id then
    raise exception using errcode = '22023', message = 'QR does not belong to the selected attendance session';
  end if;

  if p_gate_id is null then
    raise exception using errcode = '22023', message = 'Choose the gate where you are operating the scanner';
  end if;

  select gate.id, gate.name, gate.code
  into v_gate
  from public.attendance_gates as gate
  join public.attendance_sessions as session on session.id = p_expected_session_id
  where gate.id = p_gate_id
    and gate.is_active
    and (
      (session.all_gates and not exists (
        select 1 from public.attendance_session_gates as session_gate
        where session_gate.session_id = session.id
          and session_gate.gate_id = gate.id
          and not session_gate.is_open
      ))
      or (not session.all_gates and exists (
        select 1 from public.attendance_session_gates as session_gate
        where session_gate.session_id = session.id
          and session_gate.gate_id = gate.id
          and session_gate.is_open
      ))
    );

  if not found then
    raise exception using errcode = '42501', message = 'Gate is not authorized for this attendance session';
  end if;

  perform set_config('app.attendance_gate_id', p_gate_id::text, true);
  v_result := public.register_attendance_from_qr_base(p_token);

  select record.gate_id
  into v_record_gate_id
  from public.attendance_records as record
  where record.session_id = v_qr.session_id
    and record.student_id = v_qr.student_id;

  if v_record_gate_id is not null and v_record_gate_id <> p_gate_id then
    raise exception using errcode = '42501', message = 'QR was verified at a different attendance gate';
  end if;

  return v_result || jsonb_build_object(
    'gate_id', v_record_gate_id,
    'gate_name', v_gate.name,
    'gate_code', v_gate.code
  );
end;
$$;

revoke all on function public.register_attendance_from_qr(text, uuid, uuid) from public, anon;
grant execute on function public.register_attendance_from_qr(text, uuid, uuid) to authenticated;