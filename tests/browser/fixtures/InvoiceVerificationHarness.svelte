<script lang="ts">
import InvoiceDetailModal from "../../../node_modules/@jessepomeroy/admin/dist/pages/invoicing/InvoiceDetailModal.svelte";
import type { Invoice } from "../../../node_modules/@jessepomeroy/admin/dist/types";
import { toId } from "../../../node_modules/@jessepomeroy/admin/dist/utils";
import "../../../node_modules/@jessepomeroy/admin/dist/theme.css";
import Portal from "../../../src/routes/portal/[token]/+page.svelte";
import type { PageData } from "../../../src/routes/portal/[token]/$types";
import { deliveryData } from "./data";

const overpaid = new URLSearchParams(window.location.search).get("kind") === "overpaid";
document.body.classList.add("portal-route");
let open = $state(false);
// Callback state is deliberately local. Backend persistence and receipts are
// covered by invoicePaymentJourney.test.ts, not simulated by this UI fixture.
let invoice: Invoice = $state({
  _id: toId<"invoices">("fixture-invoice-verification"),
  _creationTime: 1_700_000_000_000,
  siteUrl: "angelsrest.online",
  invoiceNumber: "VERIFY-REVISIONS",
  clientId: toId<"photographyClients">("fixture-client-verification"),
  clientName: "Synthetic invoice client",
  invoiceType: "one-time",
  status: overpaid ? "paid" : "partial",
  items: [{ description: "Revised verification session", quantity: 1, unitPrice: 20_000 }],
  paidAmount: overpaid ? 30_000 : 10_000,
});
const data: PageData = $derived({
  siteSettings: deliveryData.siteSettings,
  token: "fixture-invoice-verification",
  client: { name: "Synthetic invoice client" },
  used: false,
  businessName: "Invoice verification",
  siteUrl: "https://fixture.invalid",
  type: "invoice",
  document: invoice,
});
</script>

<button class="open-invoice" onclick={() => open = true}>Open admin invoice</button>
<Portal {data} />
{#if open}
  <div data-admin>
    <InvoiceDetailModal
      {invoice}
      templates={[]}
      onsave={async (body) => { invoice = { ...invoice, ...body }; }}
      onaction={async () => {}}
      onsend={async () => {}}
      ondelete={async () => {}}
      onshare={async () => {}}
      onemailresolved={() => {}}
      onemailrecovery={() => {}}
      onemailterminal={() => {}}
      onemailrecoverydismiss={() => {}}
      shareLinkCopied={false}
      onclose={() => { open = false; }}
    />
  </div>
{/if}

<style>
.open-invoice { position: relative; z-index: 1; margin: 1rem; padding: .75rem; }
:global([data-admin]) { color: var(--admin-text); font-family: var(--admin-font-body); }
</style>
