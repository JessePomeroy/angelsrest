<script lang="ts">
  /**
   * Checkout Success Page
   * Shown after successful Stripe payment
   */
  import SEO from "$lib/components/SEO.svelte";
</script>

<SEO 
  title="Order Confirmed | angel's rest"
  description="Thank you for your purchase!"
  url="https://angelsrest.online/checkout/success"
/>

<div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
  <!-- Success icon -->
  <div class="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-6">
    <svg class="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
    </svg>
  </div>

  <h1 class="text-3xl font-semibold mb-4">Thank you for your order!</h1>
  
  <p class="text-surface-600-300-token mb-2 max-w-md">
    Your payment was successful. You'll receive an email confirmation shortly.
  </p>
  
  <p class="text-surface-500 text-sm mb-8 max-w-md">
    Made-to-order items typically ship within 2 weeks.
  </p>

  <div class="flex gap-4">
    <a href="/shop" class="btn variant-soft-surface">
      Continue Shopping
    </a>
    <a href="/" class="btn variant-filled-primary">
      Back to Home
    </a>
  </div>
</div>
