# Security Notes

## Attendance Verification

Attendance requires an authenticated student, a session accepting registrations, eligibility for that session, and a short-lived QR token. Database constraints enforce one attendance record per student and session. Location-required sessions additionally validate the submitted latitude, longitude, and reported accuracy against active administrator-configured school locations before issuing the QR. Attendance is only recorded when an officer scans a valid, unexpired token.

Browser geolocation is a signal, not proof of physical presence. A user or device may spoof reported coordinates, and browser-reported accuracy is not independently attested. The server performs distance and session checks, but this does not make attendance impossible to fake. Deployments needing stronger assurance should consider campus Wi-Fi verification, a Bluetooth beacon, NFC, a dedicated kiosk, or device attestation where supported.

Near the configured radius, verification is conservative: the server requires `distance + reported accuracy + configured boundary uncertainty margin < radius`. A boundary or uncertain result does not count as location verified. The margin is configurable per school location; the initial default is 30 meters. This policy reduces false acceptance near the boundary but can reject valid students when GPS accuracy is poor.

Precise coordinates are transient inputs to the verification RPC and are not stored. Attendance records retain verification status, measured distance, reported accuracy, verification time, and the school-location ID. Push subscription endpoints and encryption keys are sensitive and are accessible only to their owning account and the server-side delivery process.

Location permission audit entries indicate that the authenticated student submitted a browser location for an attendance attempt; the server cannot independently attest that a browser permission prompt was granted. Audit metadata excludes precise coordinates, push endpoints, and encryption keys. Notification delivery audit entries retain only subscription/notification IDs, test status, and an optional HTTP failure code.

## Push Delivery

The VAPID private key, Supabase service-role key, and push cron secret must remain server-side. Only the VAPID public key may use a `NEXT_PUBLIC_` variable. Push delivery requires HTTPS in production; localhost is suitable for development. iOS Web Push requires the website to be installed to the home screen.