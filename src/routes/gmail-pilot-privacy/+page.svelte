<svelte:head>
  <title>Gmail pilot privacy | Angel's Rest</title>
  <meta name="description" content="How the Angels Rest Gmail pilot uses, protects, retains, and deletes connected mailbox data." />
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>

<article class="privacy-notice">
  <h1>Gmail pilot privacy</h1>
  <p>Updated November 2, 2026</p>
  <p>
    Angel's Rest, operated by Jesse Pomeroy, offers an optional Gmail connection for
    reading and replying to conversations associated with an inquiry or client.
    This notice covers the controlled testing pilot. Use only approved test accounts
    and synthetic test conversations; do not import personal or customer correspondence.
  </p>

  <h2>Your permission and the data we use</h2>
  <p>
    Google sign-in and Gmail access are separate choices. Gmail permission allows
    mailbox-wide reading and sending because Google does not offer a read permission
    limited to individually selected threads for this integration. Connecting a
    separate business mailbox does not change your admin login or site membership.
  </p>
  <p>
    The application imports only conversations explicitly associated with an
    authorized inquiry or client. A deliberate search can display candidate snippets
    and metadata so you can review a thread before linking it. It does not bulk-import
    your inbox or automatically match messages to clients by sender or subject.
    Native Gmail drafts are excluded until they become sent messages.
  </p>
  <p>For the connection and linked conversations, the application uses:</p>
  <ul>
    <li>Your connected mailbox address and an encrypted refresh credential.</li>
    <li>Participants, subjects, plain-text messages, timestamps, and provider identifiers.</li>
    <li>Attachment metadata and privately stored or retrieved photo/PDF file bytes.</li>
    <li>Drafts you save, reply and follow-up states, and evidence of send and synchronization outcomes.</li>
  </ul>

  <h2>Access, processing, and permitted use</h2>
  <p>
    Authorized administrators for your site can read its linked correspondence.
    Saved drafts are private to their authors in ordinary reads and exports. Site-wide
    deletion also removes other administrators' related drafts. Attachments require
    a current session and authorization for the associated record.
  </p>
  <p>
    Google processes mailbox access and email delivery. Convex processes and stores
    application records, credentials, and private cached files. Vercel hosts the
    application and its authenticated transport endpoints. Access is limited to
    providing the correspondence feature and necessary operation and support.
    Gmail data is not sold, used for advertising, or used to train AI models.
  </p>
  <p>
    Angel's Rest's use and transfer of information received from Google APIs will
    adhere to the <a href="https://developers.google.com/terms/api-services-user-data-policy">Google API Services User Data Policy</a>,
    including its Limited Use requirements. Mail content is treated as untrusted
    text. It cannot issue commands or trigger privileged actions, and the reader
    does not load remote email images or execute email HTML.
  </p>

  <h2>Pilot retention</h2>
  <p>
    Imported conversations expire from the application 30 days after their local
    creation. Later messages do not extend that deadline, so they may be retained
    for less than 30 days. Cleanup removes associated messages, attachment records,
    cached files, drafts, and resolved send records. Unsent cached file bytes normally
    expire after 24 hours.
  </p>
  <p>
    Queued, submitting, or uncertain sends hold the affected conversation and frozen
    evidence until reconciliation or a separately agreed erasure procedure. This
    prevents an uncertain message from being silently sent twice. An absence from a
    Gmail search does not, by itself, prove a message was never sent.
  </p>
  <p>
    The pilot has no scheduled application snapshots. Application deletion does not
    delete originals in Gmail or administrator-downloaded exports. Infrastructure
    recovery copies, if any, are subject to provider controls; their retention and
    erasure handling must be verified before this pilot accepts non-test correspondence.
    Operational monitoring is intended to use status and timing information rather
    than message bodies, filenames, search text, or credentials.
  </p>

  <h2>Your controls</h2>
  <p>
    You can export a conversation's text and metadata and download permitted original
    attachments separately. You can request deletion immediately, subject to an
    unresolved-send hold. Site-wide deletion first requires stopping synchronization.
    A minimal mailbox-to-site association remains to prevent reassignment across sites.
  </p>
  <p>
    Stopping synchronization removes the connector's local refresh credential and
    stops new application synchronization. It does not erase imported data, unlink
    Google sign-in, revoke Google's permission, or recall an accepted email. You can
    separately manage the Google grant in your
    <a href="https://myaccount.google.com/connections">Google Account connections</a>.
    Revoking a grant that also supports sign-in can affect that login method; retain
    another way to access your administrator account.
  </p>

  <h2>Questions and deletion requests</h2>
  <p>
    Contact <a href="mailto:thinkingofview@gmail.com">thinkingofview@gmail.com</a>
    about access, exports, deletion, or a retention hold. Include the relevant account
    and request, without sending passwords, credentials, or unnecessary message content.
    Production use and its retention policy require a separate launch decision.
  </p>
</article>

<style>
  .privacy-notice { max-width: 70ch; margin-inline: auto; padding-block: 1rem 3rem; font-size: 1rem; line-height: 1.75; overflow-wrap: anywhere; }
  h1 { margin: 0 0 1rem; font-size: clamp(1.8rem, 4vw, 2.5rem); line-height: 1.2; text-wrap: balance; }
  h2 { margin: 2rem 0 0.75rem; font-size: 1.4rem; line-height: 1.35; }
  p { margin: 0 0 1.25rem; }
  ul { margin: 0 0 1.25rem; padding-inline-start: 1.5rem; list-style: disc; }
  li { margin-block: 0.5rem; }
  a { color: inherit; text-decoration: underline; text-underline-offset: 0.18em; }
  a:focus-visible { outline: 2px solid currentColor; outline-offset: 3px; }
</style>
