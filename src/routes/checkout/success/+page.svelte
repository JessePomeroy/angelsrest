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
  
  // Get order details from server loader
  let { data } = $props();
  
  // Format currency for display
  function formatCurrency(amountInCents: number, currency: string = 'usd') {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency.toUpperCase(),
    }).format(amountInCents / 100);
  }
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
      <svg class="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
      </svg>
    </div>
    
    <h1 class="text-3xl font-semibold mb-4">Thank you for your order!</h1>
    <p class="text-surface-600-300-token">
      Your payment was successful. You'll receive an email confirmation shortly.
    </p>
  </div>

  <!-- Order Details (if available) -->
  {#if data.orderDetails}
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
          {#each data.orderDetails.items as item}
            <div class="flex justify-between items-center py-1">
              <span>{item.description}</span>
              <span>{formatCurrency(item.amount, data.orderDetails.currency)}</span>
            </div>
          {/each}
        </div>
      {/if}
      
      <!-- Total -->
      <div class="border-t border-surface-300-600-token pt-2 mb-4">
        <div class="flex justify-between items-center font-medium">
          <span>Total Paid:</span>
          <span>{formatCurrency(data.orderDetails.amountTotal, data.orderDetails.currency)}</span>
        </div>
      </div>
      
      <!-- Shipping Address -->
      {#if data.orderDetails.shippingAddress}
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

  <!-- Next Steps -->
  <div class="bg-blue-50 dark:bg-blue-950/30 rounded-lg p-6 mb-8">
    <h3 class="font-medium mb-2">What happens next?</h3>
    <ul class="text-sm text-surface-600-300-token space-y-1">
      <li>• You'll receive an email confirmation shortly</li>
      <li>• Your order will be processed within 1-2 business days</li>
      <li>• Made-to-order prints typically ship within 2 weeks</li>
      <li>• You'll get a tracking number once your order ships</li>
    </ul>
  </div>

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

<!--
  Enhancement Ideas for Future Development:
  
  1. Order Summary Display:
     - Fetch order details using session_id URL parameter
     - Show purchased items, quantities, total paid
     - Include order number for customer reference
  
  2. Next Steps Information:
     - Estimated delivery date
     - Tracking information (when available)
     - Contact information for questions
  
  3. Analytics Tracking:
     - Conversion tracking for ad platforms
     - Revenue tracking for analytics
     - Customer acquisition metrics
  
  4. Upselling Opportunities:
     - "Customers who bought this also liked..."
     - Email subscription signup
     - Social media follow prompts
  
  5. Trust Building Elements:
     - Customer testimonials
     - Money-back guarantee reminder
     - Secure payment badges
  
  Code Pattern for Fetching Order Details:
  ```typescript
  // In a future load function
  export async function load({ url }) {
    const sessionId = url.searchParams.get('session_id');
    if (sessionId) {
      // Fetch order details from Stripe or your database
      const orderDetails = await getOrderBySessionId(sessionId);
      return { orderDetails };
    }
    return {};
  }
  ```
-->