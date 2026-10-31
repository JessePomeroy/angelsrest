# Tenant inquiry intake

Queen Worm reuses the shared Convex inquiries and shared Admin Inquiries page.
Its own `/api/contact` host route forwards validated input to the hub's
`POST /api/tenant-contact`. The hub resolves one tenant from a dedicated intake
credential, verifies that tenant's Turnstile secret, canonical hostname and `contact`
action, checks platform availability, saves through the existing `inquiries.create`,
and atomically queues an owner notification. The broad `WEBHOOK_SECRET` never leaves the hub.
The Angels Rest `/api/contact` path queues through the same durable runner using its existing owner and sender.

Configure `INQUIRY_TENANTS` as a complete JSON object keyed by stored tenant key.
Each value contains `origin` (exact canonical HTTPS origin), `secrets` (one or two
unique, purpose-scoped intake credentials), `turnstileSecret`, and `notification` with
`from`, `to`, `brand`, and `apiKey` (that tenant's domain-restricted Resend sending key).
Missing notification settings fail configuration validation;
this is the full saved-inquiry and owner-notification flow. The sender domain must
match the configured canonical hostname; the notification recipient and sender are
server configuration, never request fields. Duplicate intake keys or reuse of
`WEBHOOK_SECRET` are rejected. Back up the complete registry and preserve other tenants.

For Queen Worm, keep the stored key `queenworm.angelsrest.online`, origin
`https://queenworm.com`, approved brand Queen Worm, the existing verified
`no-reply@queenworm.com` sender, and her existing default owner email as the recipient.
The user confirmed this recipient choice on October 29. Do not copy the address into
public repository fixtures. Provision a fresh intake credential and save it in the
approved secret store; place only that tenant credential in the spoke's
`INQUIRY_BRIDGE_SECRET`. The spoke also needs the matching `PUBLIC_TURNSTILE_SITE_KEY`
and the canonical origin/hub URL. Configure Turnstile for the canonical hostname.
Do not distribute the verification secret or hub webhook credential to the browser.

The hub's default sending key is restricted to its own domain. Tenant notifications
use their configured sending key without replacing the hub transport. Staging still
uses its dedicated test key and delivery simulator; tenant keys cannot bypass that
isolation. Keep sending keys only in the private registry and its complete secure
backup, never in a spoke or public configuration.

The notification uses the existing HTML renderer with tenant branding, escaped
visitor content, a plain-text part, the visitor as Reply-To, and an idempotency key
based on the saved inquiry ID. A provider failure leaves the inquiry saved and returns success after atomic enqueue. The durable job retries with the same frozen content, sender credential fingerprint, and provider idempotency key. It stops after five automatic attempts or before the 24-hour provider replay window expires. The Admin inquiry dialog exposes queued, sending, provider-accepted, failed, and uncertain states, with at most three safe manual recoveries inside that window. Provider acceptance is not inbox delivery. Changed sender credentials stop the job; do not issue a fresh key to resolve uncertainty.

Configure `INQUIRY_NOTIFICATION_RUNNER_SECRET` (a unique 32–512 character secret) on both the hub host and Convex, and `INQUIRY_NOTIFICATION_RUNNER_ORIGIN` on Convex as the exact HTTPS origin of the matching hub deployment. Never use a protected preview or production origin as a staging substitute. This purpose-specific credential must differ from every other authority. No spoke receives it. The runner authenticates the job lease and resolves sending credentials from private host configuration. No automatic visitor acknowledgment or inquiry resubmission is added.

A bounded per-tenant burst limit supplements single-use server-verified Turnstile
challenges. The spoke also checks same-origin submissions, bounded fields and an
instance burst limit. These in-memory limits are supplemental, not a durable global
quota. No attachment, custom recipient, tenant selection, or subscription operation
is accepted by the public request.

Local verification uses synthetic credentials, challenge responses, Convex writes and
email transports. No live inquiry or email has been sent for this implementation.
Before activation, deploy the additive hub route and spoke together, configure the
registry and challenge, then perform an authorized synthetic public submission and
confirm both the correct tenant's dashboard record and provider/recipient delivery.
Check rejected challenge, other-tenant injection, origin denial and disabled intake.
Do not claim launch readiness from local checks or package installation.
