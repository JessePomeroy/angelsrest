<!--
  Checkout Success Page - Order Confirmation with Details
  
  Now fetches and displays complete order information including:
  - Order summary
  - Shipping address
  - Payment confirmation
  - Next steps
-->

<script lang="ts">
import SEO from "$lib/components/SEO.svelte";
import { formatCents } from "$lib/utils/format";
import type { PageData } from "./$types";

// Get order details from server loader
let { data, form }: { data: PageData; form?: { verifyError?: string } } = $props();
</script>

<!--
  SEO Configuration for Success Page
  
  Why this matters:
  - Success pages shouldn't be indexed (noindex recommended)
  - Clear title helps with browser history
  - Meta description appears in browser tabs
  - Proper URL structure helps with analytics
-->
<SEO 
  title="Order Confirmed | angel's rest"
  description="Thank you for your purchase!"
  url="https://angelsrest.online/checkout/success"
/>

<!-- Success Page Content -->
<div class="confirmation-page">
  
  <!-- Success Icon and Header -->
  <div class="confirmation-header">
    <div class="success-mark">
      <svg class="success-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
      </svg>
    </div>
    
    <h1 class="page-title">Thank you for your order!</h1>
    <p class="confirmation-message">
      {#if data.orderDetails?.paymentStatus === "paid" && data.orderDetails.fulfillment !== "unavailable"}
        Your payment was successful. You'll receive an email confirmation shortly.
      {:else if data.orderDetails?.paymentStatus !== "paid" && data.orderDetails}
        Your payment is not complete. Check your order status before trying again.
      {:else}
        Check your order details below or use your confirmation email for help.
      {/if}
    </p>
  </div>

  {#if data.unverified}
    <!--
      Audit H30: the /checkout/success page used to render customer PII
      off a session_id URL param alone. If the caller isn't the buyer
      (no binding cookie), we show a friendlier "look up your order"
      state instead of PII.
    -->
    <div class="verification-panel">
      <p class="privacy-message">
        This looks like a shared link. For privacy we don't show order details on this page unless you're the buyer.
      </p>
      <p class="lookup-message">
        To see your order, look it up with your email and order number at
        <a href="/orders" class="lookup-link">/orders</a>.
      </p>
      {#if data.sessionId}
        <form
          method="POST"
          action="?/verify&session_id={encodeURIComponent(data.sessionId)}"
          class="verification-form"
        >
          <input type="hidden" name="session_id" value={data.sessionId} />
          <label class="email-label" for="order-email">
            email used at checkout
          </label>
          <input
            id="order-email"
            name="email"
            type="email"
            autocomplete="email"
            required
            class="email-input"
          />
          {#if form?.verifyError}
            <p class="verification-error" role="alert">{form.verifyError}</p>
          {/if}
          <button
            type="submit"
            class="verify-button"
          >
            verify order
          </button>
        </form>
      {/if}
    </div>
  {:else if data.orderDetails}
    <div class="order-panel">
      <h2 class="details-heading">Order Details</h2>
      
      <!-- Customer Info -->
      {#if data.orderDetails.customerEmail}
        <div class="order-section">
          <span class="email-caption">Email:</span>
          <span class="customer-email">{data.orderDetails.customerEmail}</span>
        </div>
      {/if}
      
      <!-- Order Items -->
      {#if data.orderDetails.items.length > 0}
        <div class="order-section">
          <h3 class="section-heading">Items:</h3>
          {#each data.orderDetails.items as item, i (item.description ?? i)}
            <div class="item-row">
              <span>{item.description ?? "Item"}</span>
              <span>{formatCents(item.amount ?? 0, data.orderDetails.currency ?? "usd")}</span>
            </div>
          {/each}
        </div>
      {/if}
      
      <!-- Total -->
      <div class="order-total">
        <div class="total-row">
          <span>{data.orderDetails.paymentStatus === "paid" ? "Total Paid:" : "Order Total:"}</span>
          <span>{formatCents(data.orderDetails.amountTotal ?? 0, data.orderDetails.currency ?? "usd")}</span>
        </div>
      </div>
      
      <!-- Digital Download -->
      {#if data.orderDetails.downloadItems.length > 0}
        <!--
          Audit H36: downloads use the httpOnly checkout proof. Shared
          confirmation links verify the buyer email by POSTing the form
          above and redirecting back to this clean session URL.
        -->
        <div class="download-panel">
          <h3 class="download-heading">your downloads</h3>
          {#each data.orderDetails.downloadItems as ordinal (ordinal)}
            <a
              href="/api/download?session_id={encodeURIComponent(data.orderDetails.sessionId)}&item={ordinal}"
              class="download-link"
            >
              {data.orderDetails.downloadItems.length === 1
                ? "download now"
                : `download ${data.orderDetails.items[ordinal]?.description ?? `item ${ordinal + 1}`}`}
            </a>
          {/each}
          <p class="download-note">
            bookmark this page to re-download anytime.
          </p>
        </div>
      {/if}

      {#if data.orderDetails.fulfillment === "pending" || data.orderDetails.fulfillment === "unavailable"}
        <div class="verification-panel">
          <p role="status">{data.orderDetails.fulfillment === "unavailable"
            ? "downloads are unavailable for this order. Check your order status or contact us for help."
            : "Order delivery details are not available yet. Refresh this page or look up your order for help."}</p>
          {#if data.orderDetails.fulfillment === "pending"}
            <a href="/checkout/success?session_id={encodeURIComponent(data.orderDetails.sessionId)}" data-sveltekit-reload class="lookup-link">refresh order details</a>
          {/if}
          <p><a href="/orders" class="lookup-link">look up your order</a></p>
        </div>
      {/if}

      <!-- Shipping Address (physical products only) -->
      {#if (data.orderDetails.fulfillment === "physical" || data.orderDetails.fulfillment === "mixed") && data.orderDetails.shippingAddress}
        <div>
          <h3 class="section-heading">Shipping Address:</h3>
          <div class="shipping-address">
            <div>{data.orderDetails.shippingAddress.name}</div>
            <div>{data.orderDetails.shippingAddress.line1}</div>
            {#if data.orderDetails.shippingAddress.line2}
              <div>{data.orderDetails.shippingAddress.line2}</div>
            {/if}
            <div>
              {data.orderDetails.shippingAddress.city}, {data.orderDetails.shippingAddress.state} {data.orderDetails.shippingAddress.postalCode}
            </div>
            <div>{data.orderDetails.shippingAddress.country}</div>
          </div>
        </div>
      {/if}
    </div>
  {/if}

  <!-- Next Steps (different for digital vs physical) -->
  {#if data.orderDetails?.fulfillment === "digital" || data.orderDetails?.fulfillment === "mixed"}
    <div class="next-steps">
      <h3>what's included</h3>
      <ul class="steps-list">
        <li>- check your email for the order confirmation</li>
        <li>- use your confirmation email to re-verify downloads later</li>
        <li>- questions? email hello@angelsrest.online</li>
      </ul>
    </div>
  {/if}
  {#if data.orderDetails?.fulfillment === "physical" || data.orderDetails?.fulfillment === "mixed"}
    <div class="next-steps">
      <h3>What happens next?</h3>
      <ul class="steps-list">
        <li>- You'll receive an email confirmation shortly</li>
        <li>- Your order will be processed within 1-2 business days</li>
        <li>- Made-to-order prints typically ship within 2 weeks</li>
        <li>- You'll get a tracking number once your order ships</li>
      </ul>
    </div>
  {/if}

  <!-- Navigation -->
  <div class="actions">
    <a href="/shop" class="shop-link">
      Continue Shopping
    </a>
    <a href="/" class="home-link">
      Back to Home
    </a>
  </div>
</div>

<style>
  @layer components {
    .confirmation-page { max-width: 42rem; margin-inline: auto; padding-inline: 1.5rem; padding-block: 2rem; }
    .confirmation-header { text-align: center; margin-bottom: 2rem; }
    .success-mark { width: 5rem; height: 5rem; border-radius: 9999px; background-color: color-mix(in oklab, oklch(72.3% 0.219 149.579) 20%, transparent); display: flex; align-items: center; justify-content: center; margin-inline: auto; margin-bottom: 1.5rem; }
    .success-icon { width: 2.5rem; height: 2.5rem; color: oklch(72.3% 0.219 149.579); }
    .page-title { font-size: var(--text-3xl); }
    .confirmation-message { color: var(--color-surface-600); }
    :global(.dark) .confirmation-message { color: var(--color-surface-300); }
    .verification-panel { background-color: var(--color-surface-100); border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 2rem; text-align: center; }
    :global(.dark) .verification-panel { background-color: var(--color-surface-800); }
    .privacy-message { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-600); }
    :global(.dark) .privacy-message { color: var(--color-surface-300); }
    .lookup-message { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-600); }
    :global(.dark) .lookup-message { color: var(--color-surface-300); }
    .lookup-link { text-decoration-line: underline; }
    .verification-form > :not(:last-child) { margin-block-start: 0; margin-block-end: 0.75rem; }
    .verification-form { margin-top: 1.25rem; }
    .email-label { display: block; text-align: left; font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-600); }
    :global(.dark) .email-label { color: var(--color-surface-300); }
    .email-input { width: 100%; border-radius: 0.375rem; border: 1px solid; border-color: var(--color-surface-300); background-color: transparent; padding-inline: 0.75rem; padding-block: 0.5rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); }
    :global(.dark) .email-input { border-color: var(--color-surface-600); }
    .verification-error { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: oklch(63.7% 0.237 25.331); }
    .verify-button { width: 100%; border-radius: 0.375rem; background-color: var(--color-primary-500); padding-inline: 1rem; padding-block: 0.5rem; font-size: var(--text-sm); line-height: var(--text-sm--line-height); font-weight: 500; color: white; }
    .order-panel { background-color: var(--color-surface-100); border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 2rem; }
    :global(.dark) .order-panel { background-color: var(--color-surface-800); }
    .details-heading { font-size: var(--text-lg); }
    .order-section { margin-bottom: 1rem; }
    .email-caption { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-500); }
    .customer-email { margin-left: 0.5rem; }
    .section-heading { font-size: var(--text-sm); color: var(--color-surface-600); }
    :global(.dark) .section-heading { color: var(--color-surface-300); }
    .item-row { display: flex; justify-content: space-between; align-items: center; padding-block: 0.25rem; }
    .order-total { border-top: 1px solid; border-color: var(--color-surface-300); padding-top: 0.5rem; margin-bottom: 1rem; }
    :global(.dark) .order-total { border-color: var(--color-surface-600); }
    .total-row { display: flex; justify-content: space-between; align-items: center; font-weight: 500; }
    .download-panel { margin-top: 1.5rem; padding: 1rem; background-color: color-mix(in oklab, oklch(72.3% 0.219 149.579) 10%, transparent); border: 1px solid; border-color: color-mix(in oklab, oklch(72.3% 0.219 149.579) 20%, transparent); border-radius: 0.5rem; }
    .download-heading { font-size: var(--text-lg); }
    .download-link { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: normal; overflow-wrap: anywhere; font-size: var(--text-base); line-height: var(--text-base--line-height); padding-inline: 2rem; padding-block: 0.75rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-primary-500); color: oklch(12.9% 0.042 264.695); width: 100%; text-align: center; }
    .download-link:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .download-link:focus-visible { outline-color: var(--color-surface-50); }
    .download-link:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (hover: hover) { .download-link:hover:not(:disabled) { background-color: color-mix(in oklab, var(--color-primary-500) 80%, transparent); } }
    .download-note { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-500); text-align: center; }
    .shipping-address { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-700); }
    :global(.dark) .shipping-address { color: var(--color-surface-200); }
    .next-steps { background-color: oklch(97% 0.014 254.604); border-radius: 0.5rem; padding: 1.5rem; margin-bottom: 2rem; }
    :global(.dark) .next-steps { background-color: color-mix(in oklab, oklch(28.2% 0.091 267.935) 30%, transparent); }
    .steps-list > :not(:last-child) { margin-block-start: 0; margin-block-end: 0.25rem; }
    .steps-list { font-size: var(--text-sm); line-height: var(--text-sm--line-height); color: var(--color-surface-600); }
    :global(.dark) .steps-list { color: var(--color-surface-300); }
    .actions { display: flex; flex-wrap: wrap; text-align: center; gap: 1rem; justify-content: center; }
    .shop-link { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: normal; font-size: var(--text-base); line-height: var(--text-base--line-height); padding-inline: 1rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-surface-200); color: var(--color-surface-900); }
    .shop-link:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .shop-link:focus-visible { outline-color: var(--color-surface-50); }
    .shop-link:disabled { opacity: 0.5; cursor: not-allowed; }
    :global(.dark) .shop-link { background-color: var(--color-surface-700); color: var(--color-surface-50); }
    .home-link { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: normal; font-size: var(--text-base); line-height: var(--text-base--line-height); padding-inline: 1rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-primary-500); color: oklch(12.9% 0.042 264.695); }
    .home-link:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .home-link:focus-visible { outline-color: var(--color-surface-50); }
    .home-link:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (hover: hover) { .home-link:hover:not(:disabled) { background-color: color-mix(in oklab, var(--color-primary-500) 80%, transparent); } }
  }
</style>
