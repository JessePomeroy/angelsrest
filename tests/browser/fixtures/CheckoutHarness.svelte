<script lang="ts">
import Success from "../../../src/routes/checkout/success/+page.svelte";
import Cancel from "../../../src/routes/checkout/cancel/+page.svelte";
import type { PageData } from "../../../src/routes/checkout/success/$types";
const kind = new URLSearchParams(window.location.search).get("kind") ?? "basic";
function fixtureData(): PageData {
  const siteSettings = { artistName: null, siteTitle: null, tagline: null, logoUrl: null, socialLinks: [], seo: { description: null, ogImageUrl: null, keywords: [] } };
  if (["shared", "shared-no-session", "error"].includes(kind)) {
    return { siteSettings, unverified: true, sessionId: kind === "shared-no-session" ? "" : "cs_fixture", orderDetails: null };
  }
  if (!["physical", "digital"].includes(kind)) return { siteSettings, orderDetails: null };
  return { siteSettings, orderDetails: {
    sessionId: "cs_fixture", customerEmail: "buyer@example.invalid", amountTotal: 7500, currency: "usd", paymentStatus: "paid", productId: "fixture-product", productSlug: "fixture-print", isDigital: kind === "digital",
    shippingAddress: { name: "Fixture Buyer", line1: "1 Fixture Way", line2: "Studio 2", city: "Example City", state: "MI", postalCode: "00000", country: "US" },
    items: [{ description: "Fixture photograph", quantity: 1, amount: 5000 }, { description: "Companion photograph", quantity: 1, amount: 2500 }],
  } };
}
const data = fixtureData();
</script>
{#if kind === "cancel"}<Cancel />
{:else}<Success {data} form={kind === "error" ? { verifyError: "That email does not match this order." } : undefined} />{/if}
