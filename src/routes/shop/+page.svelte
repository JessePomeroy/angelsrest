<script lang="ts">
  // import { client, urlFor } from '$lib/sanity/client';
  // TODO: Fetch products from Sanity
  // const query = `*[_type == "product" && inStock == true] | order(_createdAt desc) { _id, title, slug, images, price, category }`;
</script>

<svelte:head>
  <title>shop | angel's rest</title>
</svelte:head>

<section>
  <h1>Shop</h1>
  <p class="description">Prints, zines, and more. coming soon.</p>

  <div class="grid">
    {#each Array(4) as _, i}
      <a href="/shop/placeholder-{i + 1}" class="item">
        <div class="placeholder"></div>
        <span class="title">Product {i + 1}</span>
        <span class="price">$25.00</span>
      </a>
    {/each}
  </div>
</section>

<style>
  section {
    padding: 2rem 0;
  }

  h1 {
    margin-bottom: 0.5rem;
  }

  .description {
    color: var(--color-text-muted);
    font-size: 0.9rem;
    margin-bottom: 3rem;
  }

  .grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
    gap: 2rem;
  }

  .item {
    display: flex;
    flex-direction: column;
    color: var(--color-text);
  }

  .placeholder {
    aspect-ratio: 1;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    margin-bottom: 0.75rem;
  }

  .title {
    font-size: 0.9rem;
  }

  .price {
    font-size: 0.85rem;
    color: var(--color-text-muted);
    margin-top: 0.25rem;
  }
</style>
