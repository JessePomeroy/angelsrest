# Local execution

Resolve `gmail_hub_root`, `gmail_admin_root` and a new `gmail_evidence_dir` from the
run record before using these zsh commands. They are ordinary task variables, not
credentials. Confirm the ports below are free; never stop an unrelated listener.

## Core backend and host checks

Run from the selected hub root:

```zsh
pnpm exec vitest run \
  packages/crm-api/convex/authOrigins.test.ts \
  packages/crm-api/convex/gmailAuthLink.test.ts \
  packages/crm-api/convex/gmailSync.test.ts \
  packages/crm-api/convex/gmailConversations.test.ts \
  packages/crm-api/convex/helpers/gmail/protocol.test.ts \
  src/lib/server/gmail/__tests__/handlers.test.ts
pnpm --filter @jessepomeroy/crm-api exec tsc -p tsconfig.json --noEmit
pnpm check
```

The Svelte check needs the host's nonsecret public site/Convex configuration.
Use the intended local/staging values; do not load a production credential file.
Use repository lint for changed source. The root Biome configuration excludes
Convex: report that limit rather than calling an unmatched check a backend pass.

For the real host completion page's local browser regressions:

```zsh
node scripts/run-playwright.mjs --config tests/browser/playwright.config.ts \
  gmail-connection.spec.ts --project=desktop --project=mobile
```

The existing Playwright configuration owns its isolated Vite server on port 5196
and tears it down. Record its runner/server PIDs while running; if interrupted,
verify those identities before stopping residue. The spec blocks external requests,
renders the actual host page, and substitutes only HTTP outcomes. Its result is
not Google OAuth acceptance. Retain the test report and screenshot attachments.

## Shared conversation UI

When conversation/attachment UI is in scope, run from the matching admin root:

```zsh
pnpm exec vitest run tests/GoogleAccountLink.component.test.ts tests/gmailReading.test.ts
pnpm check
mkdir -p "$gmail_evidence_dir"
node node_modules/vite/bin/vite.js --config tests/fixtures/gmail-conversations/vite.config.ts \
  > "$gmail_evidence_dir/fixture.log" 2>&1 &
gmail_fixture_pid=$!
print -r -- "$gmail_fixture_pid" > "$gmail_evidence_dir/fixture.pid"
```

Confirm `http://127.0.0.1:5289` is ready and the listener belongs to that PID.
The driver resolves Playwright from the hub's installed package and blocks all
external requests:

```zsh
GMAIL_VERIFICATION_OUTPUT="$gmail_evidence_dir" \
  node tests/fixtures/gmail-conversations/verify.mjs "$gmail_hub_root/package.json"
kill -TERM "$gmail_fixture_pid"
wait "$gmail_fixture_pid"
```

The last wait can report termination after SIGTERM; verify the recorded process
exited and port 5289 closed. Record any task-owned child PID if separate cleanup
is necessary. Retain `browser-report.json` and inspect the relevant desktop/mobile
screenshots. The driver covers actual shared inquiry/client controls, drafts,
upload failure/retry, selection confirmation, private-preview recovery, workflow
states and export, using a synthetic reactive adapter. Its tiny fake PDF upload
does not establish real PDF rendering or byte transport.

## Real provider boundary

Use the approved deployed app and the feature references for consent and a send.
Do not run the synthetic adapter against a real mailbox or substitute a direct
API mutation for the UI operation. Do not deploy local changes as an implicit
part of this recipe. Record the actual host/backend/artifact identity before
claiming that a deployed test exercised a local fix.
