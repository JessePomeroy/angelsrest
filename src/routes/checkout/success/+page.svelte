<!--
  Checkout Success Page - Post-Purchase User Experience
  
  This page is where customers land after successful payment.
  It's their confirmation that everything went smoothly.
  
  Key UX Principles Demonstrated:
  1. Immediate positive confirmation (removes anxiety)
  2. Clear next steps (what happens now?)
  3. Multiple navigation options (don't trap users)
  4. Professional appearance builds trust
  
  Educational Notes:
  - URL will include ?session_id=cs_... parameter from Stripe
  - This session ID can be used to fetch payment details
  - Success pages should be reassuring, not salesy
  - Consider this page for upselling, but carefully
-->

<script lang="ts">
  /**
   * Component Dependencies
   * 
   * We only need SEO here since this is a simple static page.
   * In more complex apps, you might:
   * - Fetch order details using the session_id parameter
   * - Track conversion events for analytics
   * - Trigger email confirmations or webhooks
   * - Show order summary with items purchased
   */
  import SEO from "$lib/components/SEO.svelte";
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

<!--
  Page Layout and Visual Hierarchy
  
  Design Principles Used:
  - Vertical centering for focus
  - Visual confirmation icon (green checkmark)
  - Progressive information disclosure (most important first)
  - Clear action buttons for next steps
-->
<div class="min-h-[60vh] flex flex-col items-center justify-center text-center px-6">
  
  <!--
    Success Icon - Visual Confirmation
    
    Psychology: Visual icons communicate faster than text.
    Green universally signals success/completion.
    
    CSS Techniques:
    - Rounded background with transparency
    - SVG for crisp icons at any size
    - Semantic color (green-500 for success state)
  -->
  <div class="w-20 h-20 rounded-full bg-green-500/20 flex items-center justify-center mb-6">
    <svg class="w-10 h-10 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
      <!-- Simple checkmark path - universally recognized symbol -->
      <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path>
    </svg>
  </div>

  <!--
    Primary Message - Immediate Confirmation
    
    Writing Guidelines:
    - Start with gratitude (builds relationship)
    - Use active voice ("Thank you" not "You are thanked")
    - Be specific ("order" not "request" or "submission")
  -->
  <h1 class="text-3xl font-semibold mb-4">Thank you for your order!</h1>
  
  <!--
    Secondary Information - What Happens Next
    
    Customer Questions to Answer:
    1. Did my payment go through? ✅ (implied by success page)
    2. Will I get confirmation? ✅ (email mention)
    3. When will it ship? ✅ (2 weeks mentioned)
    4. Is this legitimate? ✅ (professional design builds trust)
    
    Content Strategy:
    - Address the most common concerns immediately
    - Use confident language ("will receive" not "should receive")
    - Set realistic expectations upfront
  -->
  <p class="text-surface-600-300-token mb-2 max-w-md">
    Your payment was successful. You'll receive an email confirmation shortly.
  </p>
  
  <!--
    Expectation Setting for Custom Products
    
    Why This Matters:
    - Custom/made-to-order items have longer timelines
    - Setting expectations prevents support emails
    - 2 weeks is reasonable for handmade items
    - Transparency builds trust
  -->
  <p class="text-surface-500 text-sm mb-8 max-w-md">
    Made-to-order items typically ship within 2 weeks.
  </p>

  <!--
    Navigation Options - Don't Trap Users
    
    UX Principle: Always provide clear next steps.
    Two paths accommodate different user intentions:
    
    1. "Continue Shopping" - For users who want more items
    2. "Back to Home" - For users who are done
    
    Button Hierarchy:
    - Primary action (Continue Shopping) uses softer styling
    - Secondary action (Back to Home) uses stronger styling
    - This guides users toward more purchases while respecting choice
  -->
  <div class="flex gap-4">
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