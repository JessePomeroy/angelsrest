<script lang="ts">
  // import { client, urlFor } from '$lib/sanity/client';
  // TODO: Fetch gallery items from Sanity
  // const query = `*[_type == "gallery"] | order(date desc) { _id, title, slug, image, category, tags, description }`;
</script>

<svelte:head>
  <title>gallery | angel's rest</title>
</svelte:head>

<section>
  <h1>gallery</h1>
  <p class="description">
    Connect Sanity CMS to populate this gallery with your work.
  </p>

  <div class="grid">
    {#each Array(6) as _, i}
      <a href="/gallery/placeholder-{i + 1}" class="item">
        <div class="placeholder"></div>
        <span class="title">Untitled {i + 1}</span>
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
    grid-template-columns: repeat(auto-fill, minmax(300px, 1fr));
    gap: 1.5rem;
  }

  .item {
    display: block;
    color: var(--color-text);
  }

  .placeholder {
    aspect-ratio: 3 / 4;
    background: var(--color-surface);
    border: 1px solid var(--color-border);
    margin-bottom: 0.75rem;
  }

  .title {
    font-size: 0.85rem;
    color: var(--color-text-muted);
  }
</style>
