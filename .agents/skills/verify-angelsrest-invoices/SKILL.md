---
name: verify-angelsrest-invoices
description: Verify Angels Rest invoice revisions, checkout settlement, replay handling, and admin/portal balances using local integration and browser checks. Use for invoice payment verification and separately identified Stripe sandbox acceptance.
---

# Verify Angels Rest invoices

Read the repository's AGENTS.md and [feature map](references/features/README.md).
Scope is the Angels Rest hub and its **installed** admin package. Keep Reflecting
Pool excluded unless the user explicitly changes scope. This skill does not
authorize refunds, historical record repair, package releases, or production writes.

## Choose the evidence needed

- [Route and ledger journey](references/features/ledger.md): actual checkout and
  webhook handlers, Stripe SDK/signature validation, and Convex business functions
  with isolated in-memory storage. Stripe HTTP is simulated. No real charge occurs.
- [Admin and customer UI](references/features/browser.md): actual installed admin
  modal and portal components; real clicks and rendered balances, local callback
  state, no live authentication or database persistence claim.
- [Stripe sandbox acceptance](references/features/sandbox.md): complete application,
  authenticated test administrator, isolated Convex backend, and actual sandbox
  Checkout/webhook delivery. The 2026-09-27 isolated sandbox run passed revision, remaining-balance, replay,
  and overpayment cases. Record fresh evidence for each later run.

Local passes are useful regressions; they are not a substitute for sandbox acceptance.

## Run the verified local workflow

Run from the Angels Rest root. Inspect Git state and versions first. Dependencies
must already be installed with the repository's lockfile. The verified toolchain
was Node 24.18.0, pnpm 10.34.5, Playwright 1.59.1, Admin 6.4.0. Check the installed
versions on each run; do not replace the installed package with an adjacent checkout.

Use a fresh run identifier in the output paths so prior proof survives:

```zsh
mkdir -p test-results/invoice-verification-RUN
unshare -Urn sh -c 'ip link set lo up && pnpm exec vitest run src/lib/server/__tests__/invoicePaymentJourney.test.ts --reporter=json --outputFile=test-results/invoice-verification-RUN/ledger.json'
pnpm test:browser:container tests/browser/invoice-verification.spec.ts \
  --project=desktop --project=mobile --project=webkit-mobile \
  --output=test-results/invoice-verification-RUN/browser
```

The first command needs Linux user/network namespaces and `ip`. The browser
command needs Docker and the already-cached matching Playwright image. It uses
`--pull=never` and `--network none`, derives the image version from the installed
package, and prints the task-owned driver PID. Missing prerequisites are a
verification gap; do not install a different browser version to force a pass.

Playwright starts the existing fixture Vite server on container loopback port
5196, with strict port selection and no reuse. HTTP readiness is only the launch
check; the spec then proves the feature through role-based interactions. It closes
the browser and server at exit, and Docker removes the task container. If interrupted,
stop only the recorded task-owned driver/container. Confirm its process and listener
are gone; do not kill other Vite or Docker instances.

Keep the JSON, command outcomes, installed versions, source revision/dirty diff,
and screenshots. Inspect the actual images. Report failed or skipped assertions
and whether any retry followed a driver correction. When changing the workflow,
run `pnpm lint`, `pnpm check` with synthetic public Convex URLs, and relevant tests.
Validate this skill with the installed skill-creator validator when available.

## Provider acceptance

Use [sandbox acceptance](references/features/sandbox.md) only after identifying
the actual isolated app/backend and Stripe account. Never infer isolation from a
branch name, Vercel preview, CLI profile name, or `sk_test_` prefix alone. A preview
can still point at production Convex. Record the selected environment and exact
provider event evidence, without keys, login sessions, or bearer portal links in
shared artifacts. Keep unknown or unexercised stages marked pending.
