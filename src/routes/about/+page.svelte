<script lang="ts">
  import SEO from "$lib/components/SEO.svelte";
  import AsciiImage from "$lib/components/AsciiImage.svelte";
  import portrait from "$lib/assets/DSCF7533.jpg";
  import { isDark } from "$lib/stores/theme";

  let { data } = $props();

  /**
   * Theme-aware form text color
   *
   * Tailwind's dark: variant wasn't working reliably with !text-black,
   * so we use a CSS variable that updates reactively when the theme changes.
   *
   * The --form-text-color variable is applied via inline styles on form elements.
   * - Light mode: #000000 (black)
   * - Dark mode: #fafafa (near-white)
   */
  $effect(() => {
    document.documentElement.style.setProperty(
      "--form-text-color",
      $isDark ? "#fafafa" : "#000000",
    );
  });

  let status = $state("idle"); // 'idle' | 'sending' | 'success' | 'error'

  async function handleSubmit(e: SubmitEvent) {
    e.preventDefault();
    status = "sending";

    const form = e.target as HTMLFormElement;
    const data = Object.fromEntries(new FormData(form));

    try {
      const res = await fetch("/api/contact", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });

      if (res.ok) {
        status = "success";
        form.reset();
      } else {
        status = "error";
      }
    } catch {
      status = "error";
    }
  }
</script>

<svelte:head>
  <!-- Cal element-click embed code begins -->
  <script type="text/javascript">
    (function (C, A, L) {
      let p = function (a, ar) {
        a.q.push(ar);
      };
      let d = C.document;
      C.Cal =
        C.Cal ||
        function () {
          let cal = C.Cal;
          let ar = arguments;
          if (!cal.loaded) {
            cal.ns = {};
            cal.q = cal.q || [];
            d.head.appendChild(d.createElement("script")).src = A;
            cal.loaded = true;
          }
          if (ar[0] === L) {
            const api = function () {
              p(api, arguments);
            };
            const namespace = ar[1];
            api.q = api.q || [];
            if (typeof namespace === "string") {
              cal.ns[namespace] = cal.ns[namespace] || api;
              p(cal.ns[namespace], ar);
              p(cal, ["initNamespace", namespace]);
            } else p(cal, ar);
            return;
          }
          p(cal, ar);
        };
    })(window, "https://app.cal.com/embed/embed.js", "init");

    Cal("init", "photosession", { origin: "https://app.cal.com" });

    Cal.ns.photosession("ui", {
      hideEventTypeDetails: false,
      layout: "month_view",
      useSlotsViewOnSmallScreen: true,
    });
  </script>
  <!-- Cal element-click embed code ends -->
</svelte:head>

<SEO
  title="about | angel's rest"
  description="About Jesse Pomeroy — photographer, visual artist, and florist based in Michigan. Get in touch for inquiries and collaborations."
  url="https://angelsrest.online/about"
/>

<section class="px-6! md:px-8! lg:px-10!">
  <div
    class="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 lg:gap-12 max-w-[1400px]"
  >
    <!-- Portrait - card style matching product images, ASCII on hover -->
    <div class="h-fit">
      <div
        class="bg-surface-500/10 border border-surface-500/20 p-3 rounded-lg inline-block"
      >
        <div
          class="aspect-[3/4] w-64 md:w-72 lg:w-80 overflow-hidden rounded-md"
        >
          {#if data.portraitUrl}
            <AsciiImage
              src={data.portraitUrl}
              alt={data.about?.name}
              class="w-full h-full object-cover"
              resolution={12}
              scaleAdjust={1.0}
            />
          {:else}
            <AsciiImage
              src={portrait}
              alt="Portrait"
              class="w-full h-full object-cover"
              resolution={14}
              scaleAdjust={1.0}
            />
          {/if}
        </div>
      </div>
    </div>

    <!-- Bio -->
    <div class="pt-4 lg:pt-8">
      <h1 class="mb-6 text-2xl">{data.about.name}</h1>
      <p class="leading-relaxed mb-4">
        {data.about.shortBio}
      </p>
      {#if data.about?.social?.instagram}
        <p class="text-surface-400">
          <a
            href={data.about.social.instagram}
            target="_blank"
            rel="noopener"
            class="hover:text-surface-200 transition-colors">instagram</a
          >
        </p>
      {/if}
    </div>

    <!-- Contact Form -->
    <div
      class="pt-4 lg:pt-8 md:col-span-2 lg:col-span-1 md:border-t md:border-surface-500/20 md:pt-8 md:mt-4 lg:border-0 lg:mt-0"
    >
      <h2 class="mb-2 text-lg">get in touch</h2>
      <p class="text-surface-400 text-sm mb-8">
        for inquiries, commissions, and collaborations.
      </p>

      <form onsubmit={handleSubmit} class="flex flex-col gap-5">
        <div class="flex flex-col gap-2.5">
          <label for="name" class="text-sm font-medium">name</label>
          <input
            type="text"
            id="name"
            name="name"
            placeholder="your name"
            required
            style="color: var(--form-text-color);"
            class="bg-white/5 border border-white/10 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full"
          />
        </div>
        <div class="flex flex-col gap-2.5">
          <label for="email" class="text-sm font-medium">email</label>
          <input
            type="email"
            id="email"
            name="email"
            placeholder="you@example.com"
            required
            style="color: var(--form-text-color);"
            class="bg-white/5 border border-white/10 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full"
          />
        </div>
        <div class="flex flex-col gap-2.5">
          <label for="subject" class="text-sm font-medium">subject</label>
          <input
            type="text"
            id="subject"
            name="subject"
            placeholder="what's this about ?"
            style="color: var(--form-text-color);"
            class="bg-white/5 border border-white/10 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full"
          />
        </div>
        <div class="flex flex-col gap-2.5">
          <label for="message" class="text-sm font-medium">message</label>
          <textarea
            id="message"
            name="message"
            rows="4"
            placeholder="your message..."
            required
            style="color: var(--form-text-color);"
            class="bg-white/5 border border-white/10 text-sm rounded-lg px-3 py-2.5 shadow-sm placeholder:text-surface-400/70 focus:outline-none focus:border-surface-400 focus:ring-2 focus:ring-white/10 transition-all w-full resize-y"
          ></textarea>
        </div>
        <button
          type="submit"
          class="mt-2 mb-6 px-4 py-3 text-sm font-medium lowercase tracking-wide bg-white/5 dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-all cursor-pointer"
          style="color: var(--form-text-color);"
          disabled={status === "sending"}
        >
          {status === "sending" ? "sending..." : "send message"}
        </button>

        {#if status === "success"}
          <p class="text-green-400">message sent !</p>
        {/if}
        {#if status === "error"}
          <p class="text-red-400">something went wrong. try again ?</p>
        {/if}
      </form>

      <!-- Book a call section -->
      <div class="mt-20 pt-10 border-t border-gray-300 dark:border-white/20">
        <h2 class="mb-2 text-lg">
          book a session -or- prefer to schedule a call/meeting ?
        </h2>
        <p class="text-surface-400 text-sm mb-8">
          select a time that works for you.
        </p>
        <button
          type="button"
          class="w-full px-4 py-3 text-sm font-medium lowercase tracking-wide bg-white/5 dark:bg-white/5 border border-gray-300 dark:border-white/10 rounded-lg hover:bg-gray-100 dark:hover:bg-white/10 transition-all cursor-pointer"
          style="color: var(--form-text-color);"
          data-cal-link="jesse-s1wmio/photosession"
          data-cal-namespace="photosession"
        >
          book a time
        </button>
      </div>
    </div>
  </div>
</section>
