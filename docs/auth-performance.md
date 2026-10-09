# Registration, login and verification delivery

Render is the primary API and hosts the persistent email worker. Vercel remains
the SMTP relay. Deploy the updated backend on Render and the relay on Vercel.
Keep Render's `EMAIL_RELAY_URL` pointing to the Vercel `/api/email-relay` endpoint
and keep `EMAIL_RELAY_SECRET` identical on both services. No new secret is needed.

Registration waits for account creation, password hashing, an OTP and a durable
MongoDB queue entry, but never waits for SMTP on Render. It returns
`verificationEmailQueued` instead of claiming that email has already arrived.
The `verification_email_deliveries` collection and its indexes are created at
backend startup without changing existing user documents. The normal build
generates the updated Prisma client; no MongoDB SQL migration is required.

The worker wakes immediately on enqueue and recovers pending work every three
seconds. Jobs are atomically leased for 60 seconds, recover after a restart, and
retry failed delivery up to five times with short exponential backoff. SMTP
delivery is at least once: an ambiguous network timeout may produce another
copy of the same code. Used or expired codes are cancelled before delivery.
Expired or consumed OTP records remain governed by the existing OTP cleanup.

Resend reuses the valid code until it has less than one minute remaining. This
prevents delayed or reordered copies from invalidating one another. Concurrent
requests on a backend process share OTP generation; each OTP has one unique
delivery job. Successful delivery has a 30-second resend cooldown. A failed job
can be restarted by a manual resend. The frontend displays pending, sent or
failed delivery using `POST /auth/verification-email-status`, and all verify,
resend and login requests have timeouts. SMTP acceptance means sent, not a
guarantee that a provider has placed the message in the inbox.

Registration uploads directly from the browser to Render, avoiding the extra
frontend Server Action hop. Auth forms make one health request on mount to
begin waking a sleeping backend while the user types. Better Auth initializes
at backend startup and shares the primary Prisma connection pool. Registration
does not create an unused Better Auth session before email verification.
Password hashing and checks for suspended or unverified users remain intact.
Profile loading still authenticates through `/auth/me`, but does not refresh an
unexpired token merely because the frontend's JWT secret differs.

For consistently fast first requests, use a Render instance that stays awake.
A free instance can sleep after inactivity; code cannot remove the resulting
startup delay or guarantee submillisecond remote authentication or email inbox
arrival. Measure registration response time separately from SMTP acceptance and
inbox delivery. Check two consecutive attempts as well as an idle first request.

Validation: `npm run build`, `npx tsc --noEmit -p tsconfig.build.json`, and
`node --test test/auth-delivery.test.js test/email-relay.test.js test/message-realtime.test.js`.
