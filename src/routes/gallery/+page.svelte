<script lang="ts">
  /**
   * Gallery Index Page
   * Shows a grid of all galleries — click one to view its images.
   * Data comes from +page.server.ts which fetches from Sanity.
   */
  import SEO from "$lib/components/SEO.svelte";

  // Page data from the load function (contains galleries array)
  let { data } = $props();
</script>

<SEO 
  title="gallery | angel's rest"
  description="Photo galleries by Jesse Pomeroy. Portrait, landscape, street, and editorial photography."
  url="https://angelsrest.online/gallery"
/>

<!-- 
  Gallery grid
  - Responsive columns: 2 on mobile, 3 on medium screens
  - Each gallery links to /gallery/[slug] for the detail view
-->
<div class="px-6! md:px-8! lg:px-10!">
  <div class="grid grid-cols-2 md:grid-cols-3 gap-4">
    {#each data.galleries as gallery}
      <a href="/gallery/{gallery.slug}" class="group">
        <!-- Image container with overflow hidden for hover effect -->
        <div class="overflow-hidden">
          <img
            src={gallery.preview}
            alt={gallery.title}
            class="w-full h-auto object-contain group-hover:scale-105 transition-transform rounded-md"
          />
        </div>
        <!-- Gallery title -->
        <h2 class="mt-2 font-medium">{gallery.title}</h2>
      </a>
    {/each}
  </div>
</div>
