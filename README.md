# Attendance System

An attendance workspace built with Next.js App Router, Tailwind CSS, Supabase, and ESLint.

## Setup

Install dependencies and create a local environment file from the example:

```bash
npm install
cp .env.example .env.local
```

Set `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` in `.env.local` using the values from your Supabase project. Keep `.env.local` out of version control; it is ignored by Git.

For email, set `RESEND_API_KEY`, `RESEND_FROM_EMAIL` to a verified sender, `SUPABASE_SERVICE_ROLE_KEY`, and a strong `EMAIL_CRON_SECRET`. Never expose the service-role key or cron secret with a `NEXT_PUBLIC_` prefix. Configure your hosting scheduler to call `POST /api/cron/notification-emails` once per minute with `Authorization: Bearer <EMAIL_CRON_SECRET>`. Configure Supabase Auth SMTP with Resend for confirmation and password-reset emails.

For browser push, generate a VAPID key pair with `npx web-push generate-vapid-keys`. Set `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (for example, `mailto:admin@example.edu`), `SUPABASE_SERVICE_ROLE_KEY`, and a separate strong `PUSH_CRON_SECRET`. Keep the VAPID private key and cron secret server-only. Configure your hosting scheduler to call `POST /api/cron/notification-push` once per minute with `Authorization: Bearer <PUSH_CRON_SECRET>`. The notification settings page requests browser permission only after the user opens its explanation and selects Enable. Push requires HTTPS (localhost is permitted for development); iOS users must install the app to the home screen before enabling Web Push.

## Database

The initial PostgreSQL schema is in `supabase/migrations/20261004000000_initial_attendance_schema.sql`. It defines profiles linked to `auth.users`, role-controlled sessions with timezone-aware start and end times, unique attendance per student and session, notifications, and short-lived one-use QR tokens. QR tokens are returned only when issued and stored as SHA-256 hashes. Late status is applied only when an officer configures a session's optional `late_after` time.

The migration has not been applied to a Supabase project. Review it, then apply it with the Supabase CLI or the Supabase SQL editor before using database features.

## Development

```bash
npm run dev
```

The app is available at [http://localhost:3000](http://localhost:3000). The workspace overview is at `/dashboard`; `/admin`, `/login`, and `/register` are available routes. Dashboard values are sample data.

Registration and login use Supabase Auth through cookie-backed server clients. Registration validates required fields, email format, matching passwords, password strength, and free-text academic field formats on the server. Supabase Auth enforces duplicate emails and stores password credentials; profile creation is handled by the database trigger. Apply both migrations before using authentication. Email confirmation behavior follows the Supabase project's Auth settings.

New registrations receive a server-sent Resend welcome email when Resend is configured. Attendance lifecycle and attendance-record notifications are delivered from the database notification queue by the protected cron route; password reset and confirmation emails remain managed by Supabase Auth using the configured SMTP provider.

Workspace routes require a valid Supabase session and a matching `profiles` row. `/admin` is checked server-side and limited to officers and admins; Supabase RLS independently limits access to profile, session, attendance, QR, and notification data.

Officers and admins can create attendance sessions from `/admin`. Date/time inputs are interpreted in the creator's local timezone and stored as timezone-aware timestamps. Optional Course/Year/Block/Team filters use `All` to include everyone, and eligibility is enforced by the database both when a QR is issued and when attendance is recorded. Session labels are derived from the time window and attendance records: Upcoming before start, Active during the window, Completed after the window if attendance exists, and Expired if the window passes without attendance or the session is cancelled.

Administrators can manage school sites and application settings from `/admin/settings`; school locations remain admin-only under RLS. The school timezone defaults to `Asia/Manila`. Session input is converted to UTC on the server, while dashboards, history, reports, exports, and notification times convert from stored UTC timestamps using this configured timezone. Each location has a configurable uncertainty margin: a verified fix is accepted only when distance + reported accuracy + margin is strictly inside the configured radius. Near-boundary required fixes are rejected as uncertain; optional-location sessions can issue a QR without marking location verified.

Authenticated users can review browser permissions at `/settings/permissions`. Location and camera checks are one-shot and only occur after a user action. The permission page can send a test push to that user's registered devices; test sends require a user click and are audited.

Attendance sessions default to required location verification. Officers and admins can choose Optional or Disabled when creating online or off-campus sessions. Required sessions need a successful server-side geofence and configured accuracy check before a QR is issued. Attendance records retain only verification metadata; precise browser coordinates are not stored. Apply migrations in timestamp order, configure at least one active school location, and configure VAPID/cron before expecting geofenced QR or browser push delivery. Notification preference switches control browser push delivery; in-app notifications remain available.

Student and officer dashboards subscribe to Supabase Realtime only for session, attendance, and the current user's notification changes. Apply the Realtime publication migration and enable these tables in Supabase Realtime; server queries and RLS remain the source of truth.

An append-only `audit_logs` table records session creation/closure, QR attendance, and student-profile edits. Students and officers can read only their own audit events; admins can read all events. Audit metadata stores statuses and changed field names, not personal values. Apply the audit migration after the other schema migrations.

The student dashboard reads the signed-in profile, open attendance sessions, and attendance history. Students can update their names and academic details; email changes remain Auth-managed. Its `Register` action calls the student-only `issue_attendance_qr` RPC and renders the opaque token without displaying or storing it in profile data. Codes expire at the earlier of five minutes or session end; issuance is capped at three per student/session per 15 minutes, with a 10-second cooldown. Officers scan it from the admin dashboard, which calls the role-checked `register_attendance_from_qr` RPC. Apply all migrations in timestamp order before using these features.

Run the project checks with:

```bash
npm run lint
npm run build
```
