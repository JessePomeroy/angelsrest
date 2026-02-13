<script lang="ts">
  /**
   * Product Detail Page with Stripe Checkout Integration
   * 
   * This component demonstrates several advanced SvelteKit patterns:
   * 1. Dynamic routing with [slug] parameter
   * 2. Server-side data loading with type safety
   * 3. Client-side API interactions
   * 4. State management with Svelte 5 runes
   * 5. Error handling and loading states
   * 
   * E-commerce Patterns:
   * - Product gallery with lightbox
   * - Direct "Buy Now" checkout (no cart)
   * - Stock status indication
   * - Category organization
   * - Responsive design
   */

  import SEO from "$lib/components/SEO.svelte";
  import GalleryModal from "$lib/components/GalleryModal.svelte";

  /**
   * Props from Server Load Function
   * 
   * The data prop contains everything returned from +page.server.ts
   * Type safety ensures we catch errors at build time, not runtime.
   * 
   * Key principle: Server-side data loading for SEO and performance
   */
  let { data } = $props();

  /**
   * Component State with Svelte 5 Runes
   * 
   * Runes are Svelte's new reactive system:
   * - $state() for mutable reactive values
   * - $derived() for computed values
   * - More predictable than Svelte 4's reactivity
   * 
   * State Management Strategy:
   * - Keep state minimal and focused
   * - Use meaningful variable names
   * - Initialize with sensible defaults
   */
  let modalOpen = $state(false);     // Controls image lightbox visibility
  let selectedIndex = $state(0);     // Which image to show in lightbox
  let isLoading = $state(false);     // Prevents double-clicks during checkout

  /**
   * Modal Control Functions
   * 
   * Clean separation of concerns:
   * - Functions handle specific UI interactions
   * - Parameters make functions reusable
   * - State updates trigger reactive UI changes
   */
  function openModal(index: number) {
    selectedIndex = index;
    modalOpen = true;
  }

  /**
   * Utility Function - String Formatting
   * 
   * Small utility functions improve code readability:
   * - Single responsibility
   * - Easy to test
   * - Reusable across components
   */
  function formatCategory(category: string) {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  /**
   * Checkout Handler - The Core E-commerce Logic
   * 
   * This async function orchestrates the entire checkout process:
   * 1. Prevents multiple submissions
   * 2. Calls our server-side API
   * 3. Handles errors gracefully
   * 4. Redirects to Stripe's secure checkout
   * 
   * Error Handling Strategy:
   * - Try/catch for network errors
   * - Loading states for user feedback
   * - Graceful fallbacks for failures
   */
  async function handleCheckout() {
    // Prevent double-submission while processing
    isLoading = true;
    
    // Debug logging (remove in production)
    console.log('Product data:', data.product);
    
    try {
      /**
       * Prepare Checkout Data
       * 
       * We structure the data exactly as our API expects it.
       * This separation allows the API to validate and transform data.
       * 
       * Key Fields:
       * - productId: For tracking and inventory
       * - title: What customer is buying
       * - price: How much to charge
       * - image: For Stripe's checkout display
       */
      const checkoutData = {
        productId: data.product.slug,           // Unique identifier
        title: data.product.title,              // Display name
        price: data.product.price,              // Amount in dollars
        image: data.product.images[0]?.full || null, // Main product image
      };
      
      console.log('Sending to checkout:', checkoutData);
      
      /**
       * API Call to Create Checkout Session
       * 
       * fetch() API patterns:
       * 1. POST method for data mutations
       * 2. JSON content type header
       * 3. Stringify body data
       * 4. Check response status
       * 5. Parse JSON response
       * 
       * Security Note: This data goes to our server, not directly to Stripe.
       * Our server validates and processes it safely.
       */
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json' 
        },
        body: JSON.stringify(checkoutData),
      });

      /**
       * Handle API Response
       * 
       * Our API returns { sessionId, url } on success.
       * We use the URL to redirect to Stripe's hosted checkout page.
       * 
       * Alternative Approach: Use Stripe.js with sessionId
       * This approach is simpler and more reliable.
       */
      const { url } = await response.json();
      
      if (url) {
        /**
         * Redirect to Stripe Checkout
         * 
         * window.location.href triggers a full page redirect.
         * Stripe handles the entire payment process from here.
         * User will return to our success/cancel pages after payment.
         */
        window.location.href = url;
      }
      
    } catch (err) {
      /**
       * Error Handling Best Practices
       * 
       * 1. Log detailed errors for debugging
       * 2. Show user-friendly messages to customers
       * 3. Don't expose technical details to users
       * 4. Always reset loading state
       * 
       * Production Enhancement: Use toast notifications instead of alert()
       */
      console.error('Checkout error:', err);
      alert('Something went wrong. Please try again.');
      
    } finally {
      /**
       * Cleanup State
       * 
       * Always reset loading state, regardless of success or failure.
       * This prevents the button from getting stuck in loading state.
       */
      isLoading = false;
    }
  }
</script>

<!--
  SEO Configuration - Critical for Product Pages
  
  Product pages are primary entry points from search engines.
  Dynamic SEO based on product data improves discoverability.
  
  Key Elements:
  - Title includes product name and brand
  - Description uses product description or fallback
  - URL matches the current page for accuracy
-->
<SEO 
  title={`${data.product.title} | shop | angel's rest`}
  description={data.product.description || `${data.product.title} - Available in the Angels Rest shop`}
  url={`https://angelsrest.online/shop/${data.product.slug}`}
/>

<!--
  Page Layout Container
  
  Responsive design principles:
  - Padding using Tailwind's responsive system
  - Max-width prevents overly wide content
  - Centering for visual balance
-->
<div class="px-6! md:px-8! lg:px-10! max-w-6xl mx-auto">
  
  <!--
    Navigation Breadcrumb
    
    UX Benefits:
    - Shows user location in site hierarchy
    - Provides easy back navigation
    - Improves SEO with internal linking
  -->
  <a href="/shop" class="text-sm opacity-70 hover:opacity-100 mb-4 inline-block">
    ← Back to shop
  </a>

  <!--
    Two-Column Product Layout
    
    Desktop: Images left, details right
    Mobile: Stacked (grid-cols-1 implied)
    
    This layout pattern is e-commerce standard:
    - Users expect images on the left
    - Product details flow naturally on the right
    - Gap provides visual separation
  -->
  <div class="grid md:grid-cols-2 gap-8">
    
    <!--
      Product Image Gallery
      
      Features:
      - Click to open full-size lightbox
      - Main image plus thumbnail grid
      - Hover effects for interactivity
      - Graceful handling of missing images
    -->
    <div class="space-y-4">
      {#if data.product.images.length > 0}
        <!--
          Main Product Image
          
          Interaction Design:
          - Full-width button for easy clicking
          - Hover scale effect indicates clickability
          - Opens lightbox for detailed viewing
        -->
        <button class="w-full" onclick={() => openModal(0)}>
          <img
            src={data.product.images[0].full}
            alt={data.product.images[0].alt}
            class="w-full h-auto hover:scale-105 transition-transform rounded-md"
          />
        </button>

        <!--
          Additional Images Grid
          
          Only shows if there are multiple images.
          Grid layout for thumbnails with hover effects.
          Click handlers pass correct index to modal.
        -->
        {#if data.product.images.length > 1}
          <div class="grid grid-cols-3 gap-2">
            {#each data.product.images.slice(1) as image, i}
              <button
                class="aspect-square overflow-hidden rounded-md"
                onclick={() => openModal(i + 1)}
              >
                <img
                  src={image.thumbnail}
                  alt={image.alt}
                  class="w-full h-full object-cover hover:scale-105 transition-transform"
                />
              </button>
            {/each}
          </div>
        {/if}
      {:else}
        <!--
          Fallback for Missing Images
          
          Always handle edge cases gracefully.
          This prevents broken layout when images aren't available.
        -->
        <div class="aspect-square bg-surface-100-800-token rounded-md flex items-center justify-center">
          <span class="text-surface-500">No image available</span>
        </div>
      {/if}
    </div>

    <!--
      Product Information Panel
      
      Information hierarchy from most to least important:
      1. Title and category (what is it?)
      2. Price (how much?)
      3. Description (why buy it?)
      4. Stock status (can I buy it?)
      5. Purchase button (how to buy?)
    -->
    <div class="space-y-6">
      
      <!--
        Product Header
        
        Title uses semantic HTML (h1) for SEO.
        Category badge provides context and filtering option.
      -->
      <div>
        <h1 class="text-3xl font-semibold mb-2">{data.product.title}</h1>
        {#if data.product.category}
          <span class="chip variant-soft-surface">
            {formatCategory(data.product.category)}
          </span>
        {/if}
      </div>

      <!--
        Price Display
        
        Large, prominent pricing builds confidence.
        Price is critical conversion factor for e-commerce.
        
        Design Notes:
        - Large font size for visibility
        - Skeleton design tokens for theme consistency
        - Bold weight for emphasis
      -->
      <div class="text-3xl font-semibold text-surface-900-50-token">
        ${data.product.price}
      </div>

      <!--
        Product Description
        
        Conditional rendering prevents empty description blocks.
        Good typography classes improve readability.
      -->
      {#if data.product.description}
        <div class="text-surface-700-200-token">
          <p>{data.product.description}</p>
        </div>
      {/if}

      <!--
        Stock Status Indicator
        
        Visual status communication:
        - Green dot + "In stock" for available items
        - Red dot + "Out of stock" for unavailable items
        
        This reduces customer service inquiries about availability.
      -->
      <div class="flex items-center gap-2">
        {#if data.product.inStock}
          <div class="w-3 h-3 rounded-full bg-success-500"></div>
          <span class="text-sm text-surface-600-300-token">In stock</span>
        {:else}
          <div class="w-3 h-3 rounded-full bg-error-500"></div>
          <span class="text-sm text-surface-600-300-token">Out of stock</span>
        {/if}
      </div>

      <!--
        Purchase Section
        
        The conversion point of the entire page.
        Every design decision leads users to this moment.
        
        Button States:
        1. Normal: "Buy Now" (clear action)
        2. Loading: "Processing..." (prevents double-clicks)
        3. Disabled: "Out of Stock" (clear unavailability)
      -->
      <div class="space-y-3">
        <button
          class="btn variant-filled-primary w-full"
          disabled={!data.product.inStock || isLoading}
          onclick={handleCheckout}
        >
          <!--
            Dynamic Button Text
            
            Conditional rendering provides clear feedback:
            - Shows current state to user
            - Prevents confusion during processing
            - Handles edge cases gracefully
          -->
          {#if isLoading}
            Processing...
          {:else if data.product.inStock}
            Buy Now
          {:else}
            Out of Stock
          {/if}
        </button>
        
        <!--
          Trust Badge
          
          Builds confidence in payment security.
          Stripe's brand recognition reduces purchase anxiety.
        -->
        <p class="text-xs text-surface-500 text-center">
          Secure checkout powered by Stripe
        </p>
      </div>
    </div>
  </div>
</div>

<!--
  Image Lightbox Modal
  
  Conditional rendering for performance:
  - Only creates DOM elements when needed
  - Reduces initial page load time
  - Modal manages its own state and interactions
-->
{#if modalOpen}
  <GalleryModal
    images={data.product.images}
    currentIndex={selectedIndex}
    onClose={() => (modalOpen = false)}
  />
{/if}

<!--
  Enhancement Opportunities:
  
  1. Add to Cart vs Buy Now:
     - Current: Direct checkout (simpler)
     - Future: Shopping cart system (more features)
  
  2. Product Variants:
     - Size, color, material options
     - Dynamic pricing based on selections
     - Inventory tracking per variant
  
  3. Customer Reviews:
     - Star ratings and written reviews
     - Photo reviews from customers
     - Review filtering and sorting
  
  4. Related Products:
     - "You might also like..." section
     - Cross-selling opportunities
     - Automated recommendations
  
  5. Social Sharing:
     - Share buttons for social media
     - Pinterest integration for visual products
     - WhatsApp sharing for direct recommendations
  
  6. Advanced Analytics:
     - Track product page views
     - Monitor conversion rates
     - A/B test different layouts
     - Heat map analysis of user interactions
  
  Example Cart Integration:
  ```typescript
  import { cartStore } from '$lib/stores/cart';
  
  function addToCart() {
    cartStore.add({
      id: data.product.slug,
      title: data.product.title,
      price: data.product.price,
      image: data.product.images[0]?.thumbnail,
      quantity: 1
    });
  }
  ```
  
  Example Review Section:
  ```svelte
  <section class="mt-12">
    <h3 class="text-xl font-semibold mb-4">Customer Reviews</h3>
    <ReviewList productId={data.product.slug} />
  </section>
  ```
-->