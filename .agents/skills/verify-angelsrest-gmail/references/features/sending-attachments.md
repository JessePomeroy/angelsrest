# Registered conversation and attachments

## Prerequisites and drive

Use only the connected approved mailbox and an explicitly approved recipient.
An authorized self-send is the smallest check for acceptance, own-Inbox arrival
and file integrity; keep another sender's reply unverified until separately tested.
Use a clearly labeled synthetic inquiry/client, not a production customer record.

1. Open the record's **Gmail conversations** section and **open conversation for
   this record**, or select its existing registered conversation.
2. Verify the displayed destination. Enter a uniquely tagged synthetic reply.
   Choose **attach photo or PDF** and confirm each selected file is **ready**.
   An incomplete upload must remain visible after reload and block sending.
3. Submit once with **send reply**. Observe the persisted attempt/message state.
   **accepted by Gmail** proves provider acceptance only. If uncertain, use the
   existing Sent reconciliation control; never submit a replacement automatically.
4. Follow **Open in Gmail** for the exact synthetic RFC Message-ID. Confirm the
   Google account and recipient-side Inbox/spam location. Do not inspect unrelated
   correspondence. Record arrival separately from the app's accepted status.
5. Verify received filenames, including an accented name when testing encoding.
   Download originals through authorized controls, compare byte length and SHA-256
   against the selected originals, and distinguish those reads from thumbnails.
6. Reopen the app conversation. Confirm provider-observed messages do not duplicate,
   and the expected workflow state survives navigation/reload. Native replies from
   a different person require their own authorized scenario.

## Evidence and boundaries

Retain only synthetic message identifiers, timestamps, status, filenames, sizes and
hashes. Keep credentials and real mail out of artifacts. File limits are 3 MiB each,
6 MiB total, five files; no silent resizing. One-pixel PNGs prove a small PNG round
trip, not camera-photo limits, JPEG/WebP support or PDF rendering.

Source: `composeReply` in `packages/crm-api/convex/helpers/gmail/protocol.ts`,
its filename regression, `gmailState.ts` send/commit handling, host private file
handlers, and shared `GmailThread.svelte`/`GmailAttachment.svelte`.

The existing desktop/mobile driver in [local checks](../local-checks.md) rehearses the
controls without provider access. Current real acceptance and remaining gates are
in the launch packet. Do not erase accepted attempts or synthetic mailbox messages
merely to tidy a verification run; cleanup must follow its authorized scope and
preserve unresolved-send evidence.
