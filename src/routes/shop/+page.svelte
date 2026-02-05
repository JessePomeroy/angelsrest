<script lang="ts">
  import SEO from "$lib/components/SEO.svelte";
  // TODO: Shop functionality coming later
  // import { client, urlFor } from '$lib/sanity/client';
  // const query = `*[_type == "product" && inStock == true] | order(_createdAt desc) { _id, title, slug, images, price, category }`;
</script>

<SEO 
  title="shop | angel's rest"
  description="Fine art photography prints, zines, and more. Coming soon."
  url="https://angelsrest.online/shop"
/>

<section class="flex flex-col items-center justify-center min-h-[60vh] text-center">
  <h1 class="text-4xl md:text-5xl mb-4">shop</h1>
  <p class="text-lg opacity-70 mb-8">prints, zines, and more</p>
  <div class="text-sm uppercase tracking-widest opacity-50">coming soon</div>
</section>

<!-- 
  Original shop content (commented out for now):
  
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
    section { padding: 2rem 0; }
    h1 { margin-bottom: 0.5rem; }
    .description { color: var(--color-text-muted); font-size: 0.9rem; margin-bottom: 3rem; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 2rem; }
    .item { display: flex; flex-direction: column; color: var(--color-text); }
    .placeholder { aspect-ratio: 1; background: var(--color-surface); border: 1px solid var(--color-border); margin-bottom: 0.75rem; }
    .title { font-size: 0.9rem; }
    .price { font-size: 0.85rem; color: var(--color-text-muted); margin-top: 0.25rem; }
  </style>
-->
