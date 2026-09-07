<script lang="ts">
import PaymentSuccess from "../../../src/routes/invoice/payment-success/+page.svelte";
import PaymentCanceled from "../../../src/routes/invoice/payment-canceled/+page.svelte";
import Portal from "../../../src/routes/portal/[token]/+page.svelte";
import type { PageData } from "../../../src/routes/portal/[token]/$types";
import { deliveryData } from "./data";
const kind = new URLSearchParams(window.location.search).get("kind") ?? "invoice";
document.body.classList.add("portal-route");
const base = { siteSettings: deliveryData.siteSettings, token: "fixture-portal", client: { name: "Fixture client" }, used: false, businessName: "Fixture photography", siteUrl: "https://fixture.invalid" };
function createData(): PageData {
  if (kind === "quote") return { ...base, type: "quote", document: { _creationTime: 1_700_000_000_000, quoteNumber: "Q-100", status: "sent", packages: [{ name: "Portrait session", description: "A relaxed studio session.", price: 25000, included: ["One hour", "Five finished photographs"] }], notes: "Thank you for considering us." } };
  if (kind === "contract") return { ...base, type: "contract", document: { _creationTime: 1_700_000_000_000, title: "Photography agreement", status: "sent", body: "A portrait session and five finished photographs.\nDelivery within two weeks.", eventDate: "2026-10-10", eventLocation: "Fixture studio", totalPrice: 25000, depositAmount: 5000 } };
  return { ...base, type: "invoice", document: { _creationTime: 1_700_000_000_000, invoiceNumber: "INV-100", status: kind === "paid" ? "paid" : "sent", items: [{ description: "Portrait session", quantity: 1, unitPrice: 20000 }, { description: "Prints", quantity: 2, unitPrice: 2500 }], taxPercent: 6, dueDate: "2026-10-10", notes: "Thank you for your support." } };
}
const data = createData();
</script>

{#if kind === "payment-success"}<PaymentSuccess />
{:else if kind === "payment-canceled"}<PaymentCanceled />
{:else}<Portal {data} />{/if}
