# Platform client login provisioning

The creator's **Add platform client** form submits to
`POST /api/admin/platform-clients`. The host validates the session, stored hub
membership, same-origin request and normalized form details. Convex independently
requires creator membership before creating anything.

For a new login, the server generates a cryptographically random 24-character
password containing lowercase, uppercase, a number and a symbol. Better Auth's
own password hasher produces the stored credential. Only the hash is sent to
Convex; neither the plaintext password nor its hash is stored on the client row.

`platform.createClientWithAdmin` creates the tenant, Better Auth user, credential
and stable tenant membership in one Convex transaction. It grants the new
operator-created identity explicitly without setting `emailVerified` to true.
Other invitation claims still require verified email. Existing users and
credentials are left unchanged and receive no newly generated password.

The successful no-store response displays the password in the creator's existing
modal, with reveal and copy controls. The browser keeps it only in component
memory until the modal closes. The operator must save/share it securely before
closing; it cannot be read back from the application. No invitation email is sent.
An uncertain request result must be checked in the client list before retrying.
This change does not introduce an operator password-reset flow.

The client can choose **Change password** in the admin sidebar, enter the initial
password and choose their own password. This uses the installed shared admin
component and Better Auth's change-password endpoint. The initial password stays
valid until changed; automatic expiry and mandatory first-login rotation are not
part of this change.

Creating a client does not enable catalog product kinds, paid subscriptions,
Stripe/LumaPrints accounts or commerce admission. The shared Convex mutation must
be deployed before deploying the host form that calls it. Live client onboarding
and sales retain their separate activation gates.
