# Render primary backend with Vercel email delivery

Deploy this backend repository to both existing services. The standalone Vercel `/api/email-relay` function sends email without starting NestJS or connecting to MongoDB. Render continues to create and validate OTPs and handle authentication, chat, and all other APIs.

Set these server-only variables:

- Both Render and Vercel: `EMAIL_RELAY_SECRET`, the same random secret of at least 32 bytes. Never use a `NEXT_PUBLIC_` variable for it.
- Render only: `EMAIL_RELAY_URL=https://nestjs-messenger-backend.vercel.app/api/email-relay`.
- Vercel: `EMAIL_SENDER_SMTP_HOST`, `EMAIL_SENDER_SMTP_PORT`, `EMAIL_SENDER_SMTP_USER`, `EMAIL_SENDER_SMTP_PASS`, and optionally `EMAIL_SENDER_SMTP_FROM` and `SMTP_FROM_NAME`. Existing `SMTP_*` aliases are also supported. Gmail requires an app password.
- Frontend: keep `NEXT_PUBLIC_API_BASE_URL` pointing at the Render API, including `/api/v1` (or the configured API prefix).

Deploy Vercel first, configure Render, then redeploy Render and the frontend. Do not point the relay URL at Render or at the NestJS authentication endpoint. Restrict the shared secret to these two services.

SMTP verification no longer blocks backend startup. SMTP connections and relay requests have bounded timeouts. Registration still waits for confirmed delivery and reports delivery failures honestly; it preserves the created account so the user can resend the code. Resend failures return an error instead of claiming success. Authentication passwords retain their existing secure hashing.

Validate in production: create a new account, receive the OTP, verify it, sign in, and test resend. Check both services' logs if delivery fails. An unauthenticated POST to `/api/email-relay` should return 401. A GET should return 405. Never log the shared secret or OTP.

Render free services sleep after inactivity and block SMTP ports. The HTTPS relay addresses SMTP blocking, but cannot remove Render cold starts. For consistently fast login, use an always-running Render instance near your database and frontend. No fixed millisecond latency is guaranteed. Registration with a profile photo also includes Cloudinary upload time.
