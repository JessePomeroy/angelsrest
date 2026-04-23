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

// Get order details from server loader
let { data } = $props();
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
<div class="max-w-2xl mx-auto px-6 py-8">
  
  <!-- Success Icon and Header -->
  <div class="text-center mb-8">
    <div class="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mx-auto mb-6">
      <svg class="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24" aria-hidden="true">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
      </svg>
    </div>
    
    <h1 class="text-3xl font-semibold mb-4">Thank you for your order!</h1>
    <p class="text-surface-600-300-token">
      Your payment was successful. You'll receive an email confirmation shortly.
    </p>
  </div>

  {#if data.unverified}
    <!--
      Audit H30: the /checkout/success page used to render customer PII
      off a session_id URL param alone. If the caller isn't the buyer
      (no binding cookie), we show a friendlier "look up your order"
      state instead of PII.
    -->
    <div class="bg-surface-100-800-token rounded-lg p-6 mb-8 text-center">
      <p class="text-sm text-surface-600-300-token">
        This looks like a shared link. For privacy we don't show order details on this page unless you're the buyer.
      </p>
      <p class="text-sm text-surface-600-300-token mt-2">
        To see your order, look it up with your email and order number at
        <a href="/orders" class="underline">/orders</a>.
      </p>
    </div>
  {:else if data.orderDetails}
    <div class="bg-surface-100-800-token rounded-lg p-6 mb-8">
      <h2 class="text-lg font-medium mb-4">Order Details</h2>
      
      <!-- Customer Info -->
      {#if data.orderDetails.customerEmail}
        <div class="mb-4">
          <span class="text-sm text-surface-500">Email:</span>
          <span class="ml-2">{data.orderDetails.customerEmail}</span>
        </div>
      {/if}
      
      <!-- Order Items -->
      {#if data.orderDetails.items.length > 0}
        <div class="mb-4">
          <h3 class="text-sm font-medium text-surface-600-300-token mb-2">Items:</h3>
          {#each data.orderDetails.items as item, i (item.description ?? i)}
            <div class="flex justify-between items-center py-1">
              <span>{item.description ?? "Item"}</span>
              <span>{formatCents(item.amount ?? 0, data.orderDetails.currency ?? "usd")}</span>
            </div>
          {/each}
        </div>
      {/if}
      
      <!-- Total -->
      <div class="border-t border-surface-300-600-token pt-2 mb-4">
        <div class="flex justify-between items-center font-medium">
          <span>Total Paid:</span>
          <span>{formatCents(data.orderDetails.amountTotal ?? 0, data.orderDetails.currency ?? "usd")}</span>
        </div>
      </div>
      
      <!-- Digital Download -->
      {#if data.orderDetails.isDigital}
        <!--
          Audit H36: the download URL carries `&email=<buyer>` so it
          keeps working from a different browser or after the binding
          cookie expires. The /api/download endpoint accepts either the
          cookie (immediate path) or the email match (email-link path).
        -->
        <div class="mt-6 p-4 bg-green-500/10 border border-green-500/20 rounded-lg">
          <h3 class="text-lg font-medium mb-2">your download is ready</h3>
          <a
            href="/api/download?session_id={data.orderDetails.sessionId}&slug={data.orderDetails.productSlug}{data.orderDetails.customerEmail ? `&email=${encodeURIComponent(data.orderDetails.customerEmail)}` : ''}"
            class="btn variant-filled-primary px-8 py-3 w-full text-center"
          >
            download now
          </a>
          <p class="text-sm text-surface-500 mt-2 text-center">
            bookmark this page to re-download anytime.
          </p>
        </div>
      {/if}

      <!-- Shipping Address (physical products only) -->
      {#if !data.orderDetails.isDigital && data.orderDetails.shippingAddress}
        <div>
          <h3 class="text-sm font-medium text-surface-600-300-token mb-2">Shipping Address:</h3>
          <div class="text-sm text-surface-700-200-token">
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
  {#if data.orderDetails?.isDigital}
    <div class="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-6 mb-8">
      <h3 class="font-medium mb-2">what's included</h3>
      <ul class="text-sm text-surface-600-300-token space-y-1">
        <li>- check your email for the order confirmation</li>
        <li>- your download link above will always work</li>
        <li>- questions? email hello@angelsrest.online</li>
      </ul>
    </div>
  {:else}
    <div class="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-6 mb-8">
      <h3 class="font-medium mb-2">What happens next?</h3>
      <ul class="text-sm text-surface-600-300-token space-y-1">
        <li>- You'll receive an email confirmation shortly</li>
        <li>- Your order will be processed within 1-2 business days</li>
        <li>- Made-to-order prints typically ship within 2 weeks</li>
        <li>- You'll get a tracking number once your order ships</li>
      </ul>
    </div>
  {/if}

  <!-- Navigation -->
  <div class="flex gap-4 justify-center">
    <a href="/shop" class="btn variant-soft-surface">
      Continue Shopping
    </a>
    <a href="/" class="btn variant-filled-primary">
      Back to Home
    </a>
  </div>
</div>

