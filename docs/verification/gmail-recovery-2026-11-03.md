# Gmail identifier recovery and recipient evidence — 2026-11-03

The isolated pilot's five-attachment send was accepted and delivered. All five
files downloaded from the approved second mailbox matched the source SHA-256
fingerprints, totaling 6,291,456 bytes. This proves recipient byte integrity;
image/PDF rendering is a separate check. A native reply from that mailbox
subsequently imported once into the same conversation and set its workflow to
`review`, as observed through the authenticated staging export endpoint. No manual
sync was triggered; this does not distinguish push delivery from scheduled catch-up.

The recipient and sender's Gmail API record both used a provider-generated
Message-ID instead of the submitted ID. The original exact RFC search returned
zero messages. A fresh, self-addressed diagnostic with the actual site domain
also had its Message-ID replaced. Its custom `X-Angels-Rest-Send-ID` header was
preserved. The original accepted send was never retried.

The correction adds the durable server-created attempt ID to outgoing MIME.
Recovery retains the old exact-RFC search, then examines a bounded Sent window
using only the custom metadata header. It refuses incomplete scans, duplicate or
missing markers, changed full-message markers, and participant/thread/subject
mismatches. Successful reconciliation stores the actual provider Message-ID so
subsequent replies reference the delivered message. No failure path authorizes a
second submission. Older messages without this header remain held if their RFC
identifier cannot be found.

All 76 tests across the four Gmail suites pass. Offline regression coverage exercises response loss, new and existing threads,
provider ID replacement, non-Sent candidates, ambiguous/changed headers,
pagination, and mismatches. It also verifies one send POST and that unrelated
Sent-message bodies are never fetched. Backend TypeScript passes. Backend lint
passes with five pre-existing warnings; its broader formatter reports existing
formatting debt in these feature files.

The fix is committed at hub `e299c6a8` and backend release `1f610c7d`. It was
deployed only to staging `rosy-firefly-366` at 01:55:12 UTC. Root lint also passes.

Provider probes establish header preservation, bounded metadata lookup of the
unique synthetic message, and recipient byte integrity.
They are not a deployed lost-response fault-injection test. The current live
acceptance status remains in the [launch packet](../runbooks/gmail-pilot-launch.md).
Private synthetic receipts remain outside the source tree.

The lookup uses Google's documented [epoch-second date filters](https://developers.google.com/workspace/gmail/api/guides/filtering)
and [metadata header selection](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/get).
