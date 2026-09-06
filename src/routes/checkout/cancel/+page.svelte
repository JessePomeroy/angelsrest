<!--
  Checkout Cancelled Page
  
  When users cancel payment, Stripe redirects them here.
  Design focuses on empathy and easy recovery.
-->

<script lang="ts">
import SEO from "$lib/components/SEO.svelte";
</script>

<SEO 
  title="Checkout Cancelled | angel's rest"
  description="Your checkout was cancelled."
  url="https://angelsrest.online/checkout/cancel"
/>

<div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
  <h1 class="text-3xl font-semibold mb-4">Checkout cancelled</h1>
  
  <p class="text-surface-600 dark:text-surface-300 mb-8 max-w-md">
    No worries! You can return to the shop whenever you're ready.
  </p>

  <div class="flex gap-4">
    <a href="/shop" class="inline-flex items-center justify-center gap-2 rounded-md whitespace-nowrap text-base px-4 py-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 disabled:opacity-50 disabled:cursor-not-allowed bg-primary-500 text-slate-950 not-disabled:hover:bg-primary-500/80">
      Back to Shop
    </a>
  </div>
</div>