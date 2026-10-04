alter policy attendance_sessions_read_available_or_owned
on public.attendance_sessions
using (
  created_by = (select auth.uid())
  or (select public.current_profile_role()) = 'admin'::public.profile_role
  or (
    status in (
      'scheduled'::public.attendance_session_status,
      'open'::public.attendance_session_status,
      'completed'::public.attendance_session_status,
      'cancelled'::public.attendance_session_status
    )
    and (select public.current_profile_role()) in (
      'student'::public.profile_role,
      'officer'::public.profile_role
    )
  )
);