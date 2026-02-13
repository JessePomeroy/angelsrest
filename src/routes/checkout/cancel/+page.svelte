<script lang="ts">
  /**
   * Checkout Cancelled Page
   * Shown when user cancels Stripe payment
   */
  import SEO from "$lib/components/SEO.svelte";
</script>

<SEO 
  title="Checkout Cancelled | angel's rest"
  description="Your checkout was cancelled."
  url="https://angelsrest.online/checkout/cancel"
/>

<div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
  <h1 class="text-3xl font-semibold mb-4">Checkout cancelled</h1>
  
  <p class="text-surface-600-300-token mb-8 max-w-md">
    No worries! You can return to the shop whenever you're ready.
  </p>

  <div class="flex gap-4">
    <a href="/shop" class="btn variant-filled-primary">
      Back to Shop
    </a>
  </div>
</div>
