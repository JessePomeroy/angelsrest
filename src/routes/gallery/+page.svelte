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
<div class="px-2! md:px-8! lg:px-10!">
    <div class="columns-2 md:columns-3 gap-2">
        {#each data.galleries as gallery}
            <a
                href="/gallery/{gallery.slug}"
                class="group mb-2 break-inside-avoid block"
            >
                <div
                    class="bg-surface-500/10 border border-surface-500/20 p-2 rounded-lg hover:border-surface-400/40 transition-all"
                >
                    <!-- Image container with overflow hidden for hover effect -->
                    <div class="overflow-hidden rounded-md">
                        <img
                            src={gallery.preview}
                            alt={gallery.title}
                            loading="lazy"
                            class="w-full h-auto object-contain group-hover:scale-105 transition-transform"
                        />
                    </div>
                    <!-- Gallery title -->
                    <h2 class="mt-2 text-xs tracking-[0.15em] text-center">
                        {gallery.title}
                    </h2>
                </div>
            </a>
        {/each}
    </div>
</div>
