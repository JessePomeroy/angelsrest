# Workflow recovery release — October 30, 2026

Five shared workflows passed isolated staging acceptance: protected blog drafts,
complete business-record access, durable inquiry notifications, delivery upload
recovery, and explicitly activated recurring invoice drafts.

## Released components

| Component | Source or version | Observed release |
| --- | --- | --- |
| Delivery Worker | `c496745ba0c137db7ad959b934064e0398d5b93c` | PR #128 merged; production version `d7a870ca-9af5-4415-a51c-8fffc52b0c51` deployed before host activation |
| Shared Convex | `c21ad2077ee989ef7e425115ceac054b020740fb` | Reviewed source deployed to production and isolated staging; PR #742 merged as `bf955bfd8bb46b2d24af3e416ce64257659ea366`; all four search backfills completed |
| CRM API | 6.13.0 | PR #745 merged; publication run 41154441248 succeeded; immutable registry integrity verified |
| Admin | 6.14.0 | Source PR #293 and release PR #294 merged; publication run 41152372775 succeeded; all 619 installed dist files matched the reviewed source |
| Hub | `ec32d0faa057fc0a46cae61dff89aaa397eef4a9` | PR #743 merged after current-base CI 41158161724 and staging dispatch 41158156737 passed |

Production and staging have separate purpose-scoped notification runner credentials
and exact callback origins. No recurring schedule starts from historical metadata,
sends an invoice, or creates a payment automatically.

## Isolated staging observations

The runtime candidate `bc35365c7999cb798d3c6b0c0fad0b2231d5482f` passed the live
workflow checks below at `https://staging.angelsrest.online`. The final candidate
`be76b739d5f9e7ea21fe9ac85d07339ed61f9b87` added only the documentation already
merged to main; its runtime tree is identical. The squash merge has the same tree.

- Blog: two authenticated tabs preserved local work through a remote revision,
  blocked conflicting publication, downloaded the local draft, restored recovery
  after reload, and required explicit server-draft resolution. Dirty navigation
  displayed its confirmation.
- Records: paginated and exported 501 synthetic orders, 202 invoices, and 201 each
  quotes and contracts. Server filters reset pagination and exact older IDs opened
  their detail views.
- Notifications: the real staging queue, runner and Resend test recipient accepted
  four synthetic notifications. Rejected, uncertain and lost-completion starting
  states were deliberately prepared fixtures, not observed provider failures. UI
  recovery retained the existing notification job and bound sender. Acceptance
  means provider acceptance, not inbox delivery.
- Uploads: a browser stored 66 real bytes and a checkpoint before a simulated
  processing interruption. A fresh page verified the exact stored size and
  registered the original without selecting a File again. A checkpoint without
  an original received a real 404 and did not register. UI removal and registered
  file deletion completed through the Worker and metadata cleanup. Separate
  transport checks rejected size mismatch and late upload replay after deletion.
- Recurring invoices: explicit activation, pause, resume and permanent cancellation
  passed. Exactly one numbered draft was generated; it had no sent timestamp or
  payment session. Local backend tests cover calendar clamping and replay behavior.

Final staging deployment `dpl_HTNmmC1zHFbgqmecLDNcyBDRRddy` is Ready at source
`be76b739d5f9e7ea21fe9ac85d07339ed61f9b87`. Its canonical alias was stable while
anonymous `/` and `/cart` returned HTML 200. Staging artifact `13025579662` is
authenticated against dispatch 41158156737. The deployment uses the staging
project's Production target, separate from the public production project.

Documentation-only deployment attempts were intentionally skipped. The final
staging configuration refresh used the existing `VERCEL_FORCE_BUILD=1` switch in
one deployment's build environment. Project ignore rules and protections stayed
in place. The rebuilt Admin response no longer contains the temporary Worker URL.

The [native staging observation export](evidence/workflow-recovery-staging-observation-2026-10-30.json)
retains the validated build/deployment/verification records and authenticated
receipt together. The existing staging history reader rejects an older hostname's
deployment record when asked for the permanent staging origin. That historical
evidence is preserved; this export passed the same record and receipt-link
validation in an isolated current-origin history. The old mixed-origin history
was not marked healthy or rewritten. Origin-aware history collection needs a
separate maintenance correction.

## Temporary media and synthetic data cleanup

The user approved only a temporary Worker and R2 bucket, with a separate key and
no private image processor. Live recovery therefore used a small nonimage file;
it does not establish live oversized-photo processing acceptance. Native image
processing passed the earlier local Worker tests.

After acceptance, the synthetic client, delivery gallery, nine checkpoints,
canceled schedule, 501 orders, 203 invoices, 201 quotes, 201 contracts, four
inquiries and notification jobs, unpublished post/revisions and test activity
were removed. The additional invoice was the generated recurring draft.
Baseline staging records were preserved. The temporary internal fixture helper
was removed and all 237 non-generated staging Convex source files were verified
against the reviewed source before redeployment.

Only task-created media resources were removed: Worker and bucket
`gallery-recovery-staging-20261030`, 40 known object/derivative/claim keys, and the
two staging media environment entries. Fresh provider reads confirmed the Worker
and bucket absent. Removing the Worker revoked its temporary key. Permanent
runner settings and the production Worker remained intact. Staging has no
permanent delivery-media service after this bounded pilot.

## Production recovery and rollout

The previous healthy production deployment `dpl_EZxMdbvDYowEypnhUVqJGrvvMXSA`,
source `8b138162bdc35d4cf23aa8f1b1662e4f82b20837`, remains retained. Its source-bound
CI artifact is `13024834107`, from successful main CI 41154441157. Fresh canonical
alias and anonymous `/` and `/cart` checks passed in the retained
[recovery observation](../integration-evidence/releases/production/observation-6ec4cb16d31332112a7aa21056257075b721fca3be6a4f738293a7e994439de5.json).
Host rollback preserves the additive backend, Worker and their durable records.

The merged host's production deployment `dpl_HXAhKgrB5GSzLpRZkSfWupYsJxJQ` is
Ready at `ec32d0faa057fc0a46cae61dff89aaa397eef4a9` and serves the canonical aliases.
Anonymous `/`, `/cart`, and `/admin` returned HTML 200. This does not establish an
authenticated production customer workflow. Main CI 41160480819 is still pending;
its final source-bound observation must be added before this release record is
complete.

Paper editing tools were unavailable. No editable handbook board was updated or
marked verified for these new workflow states. That post-release design reference
work remains separate from runtime acceptance.
