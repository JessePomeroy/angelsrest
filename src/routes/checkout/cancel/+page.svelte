<!--
  Checkout Cancelled Page - Handling Payment Abandonment
  
  When users cancel payment (back button, close window, payment failed),
  Stripe redirects them here. This page is critical for user experience
  and potential conversion recovery.
  
  Psychology of Payment Abandonment:
  - Users often feel embarrassed or frustrated
  - They might have technical issues or need time to think
  - Aggressive messaging can permanently lose them
  - Gentle, understanding tone can recover sales
  
  Business Impact:
  - 70% of e-commerce carts are abandoned
  - 15% of those can be recovered with good UX
  - This page is your recovery opportunity
-->

<script lang="ts">
  /**
   * Minimal Dependencies for Cancel Page
   * 
   * Cancel pages should load quickly since users might be:
   * - Frustrated with a failed payment
   * - On slow connections (why payment failed)
   * - Using older devices
   * 
   * Keep it simple and fast.
   */
  import SEO from "$lib/components/SEO.svelte";
</script>

<!--
  SEO for Cancel Page
  
  Considerations:
  - Should not be indexed by search engines (noindex)
  - Title should be clear for browser history
  - Users might bookmark this accidentally
-->
<SEO 
  title="Checkout Cancelled | angel's rest"
  description="Your checkout was cancelled."
  url="https://angelsrest.online/checkout/cancel"
/>

<!--
  Page Layout - Empathetic Design
  
  Design Strategy:
  - Less celebratory than success page
  - Neutral colors instead of error red
  - Reassuring rather than disappointing
  - Quick path back to shopping
-->
<div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">

  <!--
    Header Message - Tone is Everything
    
    Language Choices:
    ✅ "Checkout cancelled" - neutral, factual
    ❌ "Payment failed" - implies user failure
    ❌ "Transaction declined" - sounds bank-related
    
    We removed the X icon because:
    - It felt punitive/negative
    - Clean design is more professional
    - Focus on message, not imagery
  -->
  <h1 class="text-3xl font-semibold mb-4">Checkout cancelled</h1>
  
  <!--
    Reassurance Message - Reduce Friction
    
    Key Messages:
    1. "No worries" - Reduces embarrassment/anxiety
    2. "Return to the shop" - Keeps door open
    3. "Whenever you're ready" - No pressure
    
    What We Avoid:
    - Mentioning failed payments (could be embarrassing)
    - Asking why they cancelled (invasive)
    - Pushing immediate retry (too aggressive)
    - Making assumptions about their intent
  -->
  <p class="text-surface-600-300-token mb-8 max-w-md">
    No worries! You can return to the shop whenever you're ready.
  </p>

  <!--
    Single Clear Action - Reduce Decision Fatigue
    
    Why only one button?
    - Cancelled users are often confused or frustrated
    - Too many choices increase abandonment
    - One clear path reduces cognitive load
    
    Why "Back to Shop" instead of "Try Again"?
    - Less pressure to complete immediate purchase
    - Allows browsing to rebuild confidence
    - Doesn't assume they want the same item
  -->
  <div class="flex gap-4">
    <a href="/shop" class="btn variant-filled-primary">
      Back to Shop
    </a>
  </div>
</div>

<!--
  Advanced Recovery Strategies (Future Implementation):
  
  1. Exit Intent Detection:
     - Track when users are about to leave
     - Show discount popup or assistance offer
     - Capture email for follow-up marketing
  
  2. Abandoned Cart Recovery:
     - Email sequence with gentle reminders
     - Limited-time discount codes
     - Product scarcity messages
  
  3. Payment Assistance:
     - Link to payment help documentation
     - Contact information for support
     - Alternative payment methods
  
  4. Remarketing Setup:
     - Pixel tracking for ad retargeting
     - Custom audiences for social media ads
     - Analytics tracking of cancellation reasons
  
  5. A/B Testing Opportunities:
     - Different messaging tones
     - Discount offers vs. no discount
     - Multiple vs. single call-to-action buttons
  
  Example Enhanced Version:
  ```svelte
  <!-- Conditional discount offer for high-value carts -->
  {#if cartValue > 100}
    <div class="bg-blue-50 p-4 rounded-lg mb-6">
      <h3>Wait! Here's 10% off your order:</h3>
      <code>SAVE10</code>
      <small>Valid for the next 24 hours</small>
    </div>
  {/if}
  ```
  
  Analytics Tracking Example:
  ```typescript
  // Track cancellation for analytics
  onMount(() => {
    gtag('event', 'checkout_cancel', {
      currency: 'USD',
      value: cartTotal,
      items: cartItems
    });
  });
  ```
  
  Email Capture Example:
  ```svelte
  <!-- Optional email capture for follow-up -->
  <form class="mb-6">
    <input 
      type="email" 
      placeholder="Get notified of sales & new products"
      class="input mb-2"
    />
    <button class="btn btn-sm variant-soft">
      Keep me updated
    </button>
  </form>
  ```
-->