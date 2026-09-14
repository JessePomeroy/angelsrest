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

<div class="cancel-page">
  <h1 class="page-title">Checkout cancelled</h1>
  
  <p class="cancel-message">
    No worries! You can return to the shop whenever you're ready.
  </p>

  <div class="actions">
    <a href="/shop" class="shop-link">
      Back to Shop
    </a>
  </div>
</div>
<style>
  @layer components {
    .cancel-page { min-height: 60vh; display: flex; flex-direction: column; align-items: center; justify-content: center; text-align: center; padding-inline: 1.5rem; }
    .page-title { font-size: var(--text-3xl); }
    .cancel-message { color: var(--color-surface-600); max-width: 28rem; }
    :global(.dark) .cancel-message { color: var(--color-surface-300); }
    .actions { display: flex; gap: 1rem; }
    .shop-link { display: inline-flex; align-items: center; justify-content: center; gap: 0.5rem; border-radius: 0.375rem; white-space: nowrap; font-size: var(--text-base); line-height: var(--text-base--line-height); padding-inline: 1rem; padding-block: 0.25rem; transition-property: color, background-color, border-color, outline-color, text-decoration-color, fill, stroke; transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1); transition-duration: 150ms; background-color: var(--color-primary-500); color: oklch(12.9% 0.042 264.695); }
    .shop-link:focus-visible { outline-style: solid; outline-width: 2px; outline-offset: 2px; outline-color: var(--color-surface-900); }
    :global(.dark) .shop-link:focus-visible { outline-color: var(--color-surface-50); }
    .shop-link:disabled { opacity: 0.5; cursor: not-allowed; }
    @media (hover: hover) { .shop-link:hover:not(:disabled) { background-color: color-mix(in oklab, var(--color-primary-500) 80%, transparent); } }
  }
</style>
