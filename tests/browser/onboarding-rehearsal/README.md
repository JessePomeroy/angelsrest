# Actual-screen client onboarding rehearsal

[Latest preview — includes the LumaPrints next step](https://angelsrest-8xvccjjko-jesse-pomeroys-projects.vercel.app/admin/platform).

This separate static build imports the production Platform route (including the
real Add platform client form), shared admin layout/login, Stripe setup component
and LumaPrints setup component. Its compile-time aliases replace authentication,
Convex and transport with fictional browser-session records. It never installs a
practice-mode switch in the production SvelteKit app.

```sh
pnpm dev:onboarding-rehearsal
pnpm build:onboarding-rehearsal
```

The local app is at `http://127.0.0.1:5201/admin/platform`; the static build is
`build/onboarding-rehearsal`. A static host must serve `index.html` for its page
routes. Publish only that build, never the repository or production server output.
The build requires no provider credentials or production environment variables.

## Walkthrough

1. As the simulated operator, choose **Add platform client**.
2. Enter **Cedar Finch Studio**, **cedarfinch.example**, and
   **owner@cedarfinch.example**. Choose an access tier and **Add client**.
3. The new client is selected in Stripe Connect. Choose **open setup page**.
4. Use the displayed fictional email and password **practice-only** in the real
   login component. This is not a real account/password or authentication test.
5. **Start Stripe setup** navigates in the same tab to the labeled provider
   simulation. It does not embed or open Stripe.
6. Return without finishing to exercise incomplete setup, or complete the
   simulation to return with pending verification. **Check status again** advances
   the simulated pending status to ready. Real verification is not instantaneous.
7. The ready screen includes **Next: set up LumaPrints**. Its signup link opens a
   labeled simulation in this rehearsal; the production component links to
   `https://dashboard.lumaprints.com/account/register/`. Return to payment setup.
8. Use **Operator Platform**, select the client, and open **Set up this client's
   LumaPrints store**. Select the fictional store, make both confirmations and save.
9. **Reset practice data** removes only this tab's rehearsal session.

Only fictional `.example` websites/email addresses are accepted by the rehearsal
adapter. No password is persisted. Provider links are intercepted locally; fetch
is refused, and the CSP disallows provider frames and form submissions. Fontshare
supplies the same fonts used by the application. Rehearsal records are private to
the browser tab's session and are not written to Convex, Stripe, LumaPrints or Resend.

The production form uses the existing authenticated HTTP mutation transport and
creator-authorized `platform.createClient`. It grants the supplied admin email
site membership, but does not create a password, send an invitation, configure a
spoke/domain, charge a subscription, create provider accounts or admit commerce.
New login enrollment outside existing supported sign-in remains separate.

## Scope of verification

This rehearses the actual frontend controls, screen transitions and client-creation
input contract. Authentication, database persistence and provider responses are
simulated. It does **not** establish real provider acceptance, tax decisions,
release/backend adoption or readiness to activate a real shop. Client email-domain
configuration, checkout/refunds and new account-replacement flows are outside this
onboarding preview. The selected Stripe integration remains a same-tab redirect.


## Preview and verification record — 2026-09-22

[Open the hosted rehearsal](https://angelsrest-3x3x61qyd-jesse-pomeroys-projects.vercel.app/admin/platform).
The existing Vercel preview protection may ask for the operator's Vercel login.
Deployment `dpl_8T3vvYaqS6bYw926fdW5oikp9MaK` is READY. No production alias or
project protection was changed. The browser session used here was signed out of
Vercel, so hosted rendering remains unverified; the full local journey passed.

The preview contains only the three static Vite output files and
`vercel-output.json` as the Build Output API configuration. A separate temporary
staging directory held `.vercel/output/static`, `.vercel/output/config.json` and
the existing project ID linkage. It was deployed with `vercel deploy --prebuilt
--target preview`; the repository's SvelteKit server output and environment files
were not uploaded. Keep this deployment until the owner's walkthrough is done;
record it as a later cleanup candidate.

Observed locally: desktop/mobile creation, validation/duplicate recovery,
cancel/focus return, actual login/error/sign-out controls, same-tab provider
handoff, incomplete/pending/ready states, simulated supplier save and reset.
Unit/protocol suites, lint, host/Convex type checks and both production/rehearsal
builds passed. The main build used command-scoped harmless public Convex URLs and
retained existing optional React Email/Sharp tracing warnings. No real providers
were exercised. Paper update/comparison is pending signed-in edit access.


### LumaPrints next-step update — 2026-09-22

The ready Stripe screen now links to LumaPrints signup with two short sentences
about creating/using an account, adding a Standard Store and billing details,
and telling Angels Rest when ready. The signup URL was verified from the
[LumaPrints homepage](https://www.lumaprints.com/); the Standard Store requirement
is documented in the [official API guide](https://api-docs.lumaprints.com/doc-2394350).
The rehearsal intercepts this link to a labeled simulation with a return link.

Local checks passed: pending/ready visibility, desktop/mobile rendering,
simulated provider navigation and return, no console warnings/errors, lint,
Svelte check 0/0 and static build. New preview deployment
`dpl_2UD7YJoQvDwEsihjQCvRa1R7eGUg` is READY. Hosted browser verification still
reaches Vercel login. The new preview starts a fresh browser-tab practice session;
the old preview remains available until scoped cleanup. Production source remains
uncommitted and unmerged at that preview's creation. No real provider registration
or billing action occurred. These existing previews predate the audit fixes below.

### Scoped pre-merge audit follow-up — 2026-09-22

The Ponytail/Deslop pass covered pending onboarding changes and their immediate
integration points. Two findings were fixed: mobile dragging is disabled while
the client form saves, and duplicate website conflicts use a Convex application
error so their recovery message survives production error redaction.

Focused validation: 87 unit/backend tests, desktop/mobile Chromium regression
tests for delayed-save failure/retry and duplicate recovery, plus the existing
Stripe state browser tests. Lint, host/Convex type checks and static build passed.
The mobile failure was also checked interactively at 390×844: the form stayed
onscreen after a drag and its buttons remained reachable after the failure.
Local WebKit cannot start because libicudata.so.74 is missing; CI must cover it.
Paper editing/comparison remains pending signed-in access. Convex deployment and
package publication remain separate from merging the source.
