# Admin and customer invoice presentation

Driver: `tests/browser/invoice-verification.spec.ts` using the existing fixture
server/config and `InvoiceVerificationHarness.svelte`. The harness imports the
installed Admin package's real invoice modal by package-relative file path because
the modal is not a public package export. If the package moves it, update this
fixture after inspecting the new package; do not copy its implementation.

Entry: fixture query `?fixture=invoice-verification`, or append `&kind=overpaid`.
Playwright navigates using the existing base URL `http://127.0.0.1:5196` inside
the task container. Every non-loopback browser request is denied; the container
also has no external networking. Public-site font downloads are replaced by the
existing offline fixture font setup.

Partial invoice:

- Portal shows $200 total, $100 received, $100 due and an enabled **Pay Now**.
- Click **Open admin invoice**, then **edit**. Fill the **Unit price** spinbutton
  with `250` dollars and click **save changes**.
- The dialog shows $100 received and $150 due. Capture `admin-partial.png`.
- Press Escape, wait for the dialog to disappear, then prove the portal agrees
  and capture `portal-partial.png`.
- Reopen, edit the price to `999`, and click **cancel**. The balance stays $150.
  Click **Close dialog** and wait for removal before asserting the portal value;
  mobile sheets have an exit transition.

Overpaid invoice:

- The separate fixture has $200 total and $300 received. The portal shows the
  $100 overpayment and has no **Pay Now** button.
- Open the admin invoice. Its status text also reports $100 overpaid and it
  displays $300 received. Capture both `*-overpaid.png` images.

Wait for the modal document to enter the viewport before capturing it; DOM
visibility alone can pass while a mobile sheet is still offscreen. Screenshots
disable finite animations so the image records the settled state.

The same two cases run in desktop Chromium, mobile Chromium, and mobile WebKit:
six assertions-driven scenarios, with page errors collected. Files are under the
chosen Playwright output directory and survive container cleanup.

The `onsave` callback updates only fixture memory. Reload resets the fixture.
Do not describe this as database persistence, authenticated admin verification,
or a Stripe payment. The separate route/ledger journey covers backend behavior.
