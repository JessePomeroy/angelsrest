# Tenant inquiry intake

Queen Worm reuses the shared Convex inquiries and shared Admin Inquiries page.
Its own `/api/contact` host route forwards validated input to the hub's
`POST /api/tenant-contact`. The hub resolves one tenant from a dedicated intake
credential, verifies that tenant's Turnstile secret, canonical hostname and `contact`
action, checks platform availability, saves through the existing `inquiries.create`,
and attempts an owner notification. The broad `WEBHOOK_SECRET` never leaves the hub.
The existing Angels Rest `/api/contact` path and default notification remain intact.

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
based on the saved inquiry ID. An email provider failure leaves the inquiry saved
and returns success, matching the existing contact route. A sanitized Sentry error
identifies notification failure without visitor content. No automatic email retry or
recipient acknowledgment email is added; owners can recover the message in Inquiries.
Transport uncertainty does not trigger an automatic inquiry resubmission.

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
