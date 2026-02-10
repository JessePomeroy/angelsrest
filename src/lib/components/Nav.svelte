<script lang="ts">
  import { page } from "$app/state";
  import ThemeSwitcher from "./ThemeSwitcher.svelte";

  let isHome = $derived(page.url.pathname === "/");

  const links = [
    { href: "/", label: "Home" },
    { href: "/gallery", label: "Gallery" },
    { href: "/blog", label: "Blog" },
    { href: "/shop", label: "Shop" },
    { href: "/about", label: "About" },
  ];
</script>

<nav
  class="hidden md:flex w-full items-center justify-between px-8 py-6 max-w-[1400px] !mx-auto border-b border-surface-500/20"
>
  <a href="/" class="text-sm tracking-widest lowercase font-light text-gray-900 dark:text-surface-50"
    >angel's rest</a
  >
  <div class="flex items-center gap-8">
    <ul class="flex gap-8 list-none">
      {#each links as link}
        <li>
          <a
            href={link.href}
            class="text-xs tracking-wider lowercase transition-colors duration-200 {page
              .url.pathname === link.href ||
            (link.href !== '/' && page.url.pathname.startsWith(link.href))
              ? 'text-gray-900 dark:text-surface-50'
              : 'text-gray-600 hover:text-gray-900 dark:text-surface-400 dark:hover:text-surface-50'}"
          >
            {link.label}
          </a>
        </li>
      {/each}
    </ul>
    {#if isHome}
      <ThemeSwitcher />
    {/if}
  </div>
</nav>
