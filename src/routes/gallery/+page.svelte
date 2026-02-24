<script lang="ts">
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
  <div class="columns-2 md:columns-3 gap-4">
    {#each data.galleries as gallery}
      <a href="/gallery/{gallery.slug}" class="group mb-4 break-inside-avoid block">
        <!-- Image container with overflow hidden for hover effect -->
        <div class="overflow-hidden">
          <img
            src={gallery.preview}
            alt={gallery.title}
            class="w-full h-auto object-contain group-hover:scale-105 transition-transform rounded-md"
          />
        </div>
        <!-- Gallery title -->
        <h2 class="mt-3 text-xs tracking-[0.15em]">{gallery.title}</h2>
      </a>
    {/each}
  </div>
</div>
