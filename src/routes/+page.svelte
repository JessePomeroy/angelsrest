<script>
  import heroGif from "$lib/assets/clouds2.gif";
</script>

<svelte:head>
  <title>angel's rest</title>
  <meta name="description" content="Photography portfolio and print shop" />
</svelte:head>

<section
  class="flex flex-col items-center justify-center text-center min-h-[70vh] gap-6"
>
  <img src={heroGif} alt="Angel's Rest" class="max-w-full w-200" />

  <p class="text-surface-400 text-sm tracking-[0.2em] lowercase">
    artist in residence[midwest]
  </p>
  <div class="flex gap-4 mt-4">
    <a
      href="/gallery"
      class="btn preset-filled-surface-50 px-8 py-3 text-xs tracking-[0.15em] uppercase"
      >View Gallery</a
    >
    <a
      href="/shop"
      class="btn preset-outlined-surface-50 px-8 py-3 text-xs tracking-[0.15em] uppercase"
      >Shop Prints</a
    >
    <a
      href="/book"
      class="btn preset-outlined-surface-50 px-8 py-3 text-xs tracking-[0.15em] uppercase"
      >Book Session</a
    >
  </div>
</section>
