# Client commerce email identity

Angels Rest owns the Resend account and the existing server-only sending key. Clients do not need their own Resend accounts for this managed commerce flow. Each enabled client supplies an approved sending domain, sender name/address, an existing monitored reply mailbox, and the mailbox that receives order/fulfillment notifications.

The Hub resolves stable tenant identity from its stored client/payment/supplier context. `CLIENT_COMMERCE_EMAIL_ENABLED=true` requires a matching server-only `CLIENT_COMMERCE_EMAIL_IDENTITIES` entry for that tenant and current canonical website. Browser checkout fields and Stripe metadata cannot directly choose email headers or operator recipients. Missing, malformed, duplicate or mismatched client configuration stops mail; it does not fall back to a different client or the central sender. Hub-owned email keeps its current identity.

Example, fictional and non-secret:

```json
{"version":1,"clients":[{"tenantId":"tenant_05eb6092-5d8c-43ce-ad26-1a59522bd07b","siteUrl":"studio.example","verifiedDomain":"mail.studio.example","fromName":"Studio","fromEmail":"orders@mail.studio.example","replyTo":"hello@studio.example","notificationEmail":"owner@studio.example"}]}
```

`verifiedDomain` is an operator-approved configuration declaration, not a claim that this implementation has checked live DNS or provider state. Before enabling, verify that exact domain in the operator's Resend account, review the key's permitted domain scope, and confirm an authorized test reaches the intended mailbox and replies reach the monitored reply address. Resend enforces sending-domain authorization at send time. Reply-To does not create or host an inbox. No domain, DNS, key, mailbox or account is provisioned by this code.

Sender domain must exactly match `verifiedDomain`, and that domain must be the client website domain or its subdomain. Sender display names are quoted and header-control characters rejected. The bounded registry rejects duplicate tenant/site/sending-domain entries. Recipient addresses may be existing external mailboxes, as explicitly chosen by the operator/client.

Existing receipt, shipment, payment-failure and fulfillment/refund notification templates, durable send claims, idempotency keys and provider acceptance checks remain in use. The provider must return a delivery ID before the helper reports acceptance; this is not proof of inbox delivery. Global emergency Hub alerts remain directed to Angels Rest.

Keep configuration stable while notification attempts are unsettled. Changing headers or recipient during an uncertain retry can produce a provider idempotency-payload conflict and must be reviewed; do not rotate keys or resend under a fresh idempotency key to bypass it. A website rename requires an explicit registry update for that same stable tenant. Domain verification, test sends, activation and provider acceptance remain separately authorized rollout work.

Sources: [Resend sending API](https://resend.com/docs/api-reference/emails/send-email), [domain verification](https://resend.com/docs/dashboard/domains/introduction).
