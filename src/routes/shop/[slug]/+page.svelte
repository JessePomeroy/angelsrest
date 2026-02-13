<script lang="ts">
  /**
   * Product Detail Page with Stripe Checkout
   */

  import SEO from "$lib/components/SEO.svelte";
  import GalleryModal from "$lib/components/GalleryModal.svelte";

  let { data } = $props();

  let modalOpen = $state(false);
  let selectedIndex = $state(0);
  let isLoading = $state(false);

  function openModal(index: number) {
    selectedIndex = index;
    modalOpen = true;
  }

  function formatCategory(category: string) {
    return category.charAt(0).toUpperCase() + category.slice(1);
  }

  async function handleCheckout() {
    isLoading = true;
    
    console.log('Product data:', data.product);
    
    try {
      const checkoutData = {
        productId: data.product.slug,
        title: data.product.title,
        price: data.product.price,
        image: data.product.images[0]?.full || null,
      };
      console.log('Sending to checkout:', checkoutData);
      
      const response = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(checkoutData),
      });

      const { url } = await response.json();
      
      if (url) {
        window.location.href = url;
      }
    } catch (err) {
      console.error('Checkout error:', err);
      alert('Something went wrong. Please try again.');
    } finally {
      isLoading = false;
    }
  }
</script>

<SEO 
  title="{data.product.title} | shop | angel's rest"
  description="{data.product.description || `${data.product.title} - Available in the Angels Rest shop`}"
  url="https://angelsrest.online/shop/{data.product.slug}"
/>

<div class="px-6! md:px-8! lg:px-10! max-w-6xl mx-auto">
  <!-- Back link -->
  <a href="/shop" class="text-sm opacity-70 hover:opacity-100 mb-4 inline-block">
    ← Back to shop
  </a>

  <!-- Product layout -->
  <div class="grid md:grid-cols-2 gap-8">
    <!-- Product images -->
    <div class="space-y-4">
      {#if data.product.images.length > 0}
        <button class="w-full" onclick={() => openModal(0)}>
          <img
            src={data.product.images[0].full}
            alt={data.product.images[0].alt}
            class="w-full h-auto hover:scale-105 transition-transform rounded-md"
          />
        </button>

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
        <div class="aspect-square bg-surface-100-800-token rounded-md flex items-center justify-center">
          <span class="text-surface-500">No image available</span>
        </div>
      {/if}
    </div>

    <!-- Product details -->
    <div class="space-y-6">
      <!-- Product title and category -->
      <div>
        <h1 class="text-3xl font-semibold mb-2">{data.product.title}</h1>
        {#if data.product.category}
          <span class="chip variant-soft-surface">
            {formatCategory(data.product.category)}
          </span>
        {/if}
      </div>

      <!-- Price -->
      <div class="text-3xl font-semibold text-surface-900-50-token">
        ${data.product.price}
      </div>

      <!-- Description -->
      {#if data.product.description}
        <div class="text-surface-700-200-token">
          <p>{data.product.description}</p>
        </div>
      {/if}

      <!-- Stock status -->
      <div class="flex items-center gap-2">
        {#if data.product.inStock}
          <div class="w-3 h-3 rounded-full bg-success-500"></div>
          <span class="text-sm text-surface-600-300-token">In stock</span>
        {:else}
          <div class="w-3 h-3 rounded-full bg-error-500"></div>
          <span class="text-sm text-surface-600-300-token">Out of stock</span>
        {/if}
      </div>

      <!-- Purchase button -->
      <div class="space-y-3">
        <button
          class="btn variant-filled-primary w-full"
          disabled={!data.product.inStock || isLoading}
          onclick={handleCheckout}
        >
          {#if isLoading}
            Processing...
          {:else if data.product.inStock}
            Buy Now
          {:else}
            Out of Stock
          {/if}
        </button>
        
        <p class="text-xs text-surface-500 text-center">
          Secure checkout powered by Stripe
        </p>
      </div>
    </div>
  </div>
</div>

<!-- Lightbox modal -->
{#if modalOpen}
  <GalleryModal
    images={data.product.images}
    currentIndex={selectedIndex}
    onClose={() => (modalOpen = false)}
  />
{/if}
