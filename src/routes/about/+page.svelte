<script lang="ts">
  import SEO from "$lib/components/SEO.svelte";
  import portrait from "$lib/assets/DSCF7533.jpg";

  let { data } = $props();
</script>

<SEO
  title="about | angel's rest"
  description="About Jesse Pomeroy — photographer, visual artist, and florist based in Michigan. Get in touch for inquiries and collaborations."
  url="https://angelsrest.online/about"
/>

<section class="px-6! md:px-8! lg:px-10!">
  <div class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-12 max-w-[1400px]">
    <!-- Portrait -->
    <div class="aspect-[3/4] bg-surface-500/20 border border-surface-500/20">
      {#if data.portraitUrl}
        <img src={data.portraitUrl} alt={data.about?.name} class="w-full h-full object-cover" />
      {:else}
        <img src={portrait} alt="Portrait" class="w-full h-full object-cover" />
      {/if}
    </div>

    <!-- Bio -->
    <div class="pt-4 lg:pt-8">
      <h1 class="mb-6 text-2xl">{data.about.name}</h1>
      <p class="leading-relaxed mb-4">
        {data.about.shortBio}
      </p>
      {#if data.about?.social?.instagram}
        <p class="text-surface-400">
          <a href={data.about.social.instagram} target="_blank" rel="noopener" class="hover:text-surface-200 transition-colors">Instagram</a>
        </p>
      {/if}
    </div>

    <!-- Contact Form -->
    <div class="pt-4 lg:pt-8 md:col-span-2 lg:col-span-1 md:border-t md:border-surface-500/20 md:pt-8 md:mt-4 lg:border-0 lg:mt-0">
      <h2 class="mb-2 text-lg">get in touch</h2>
      <p class="text-surface-400 text-sm mb-8">For inquiries, commissions, and collaborations.</p>

      <form
        onsubmit={(e) => {
          e.preventDefault();
        }}
        class="flex flex-col gap-5"
      >
        <div class="flex flex-col gap-2.5">
          <label for="name" class="text-sm font-medium">Name</label>
          <input
            type="text"
            id="name"
            name="name"
            placeholder="Your name"
            required
            class="bg-white/5 border border-white/10 text-surface-50 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full"
          />
        </div>
        <div class="flex flex-col gap-2.5">
          <label for="email" class="text-sm font-medium">Email</label>
          <input
            type="email"
            id="email"
            name="email"
            placeholder="you@example.com"
            required
            class="bg-white/5 border border-white/10 text-surface-50 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full"
          />
        </div>
        <div class="flex flex-col gap-2.5">
          <label for="subject" class="text-sm font-medium">Subject</label>
          <input
            type="text"
            id="subject"
            name="subject"
            placeholder="What's this about?"
            class="bg-white/5 border border-white/10 text-surface-50 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full"
          />
        </div>
        <div class="flex flex-col gap-2.5">
          <label for="message" class="text-sm font-medium">Message</label>
          <textarea
            id="message"
            name="message"
            rows="4"
            placeholder="Your message..."
            required
            class="bg-white/5 border border-white/10 text-surface-50 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full resize-y"
          ></textarea>
        </div>
        <button
          type="submit"
          class="mt-2 px-4 py-3 text-sm font-medium uppercase tracking-wide bg-white/5 border border-white/10 text-surface-50 rounded-lg hover:bg-white/10 transition-all cursor-pointer"
        >
          Send Message
        </button>
      </form>
    </div>
  </div>
</section>
