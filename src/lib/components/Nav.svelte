<!--
  Desktop Navigation Component
  
  - Only visible on md+ screens (hidden on mobile, which uses BottomNav)
  - Shows theme switcher only on homepage
  - Uses gray colors for light mode (better contrast than theme surface colors)
  - Active link detection supports both exact match and prefix match for nested routes
-->

<script lang="ts">
  import { page } from "$app/state";
  import ThemeSwitcher from "./ThemeSwitcher.svelte";

  // Check if we're on the homepage (for conditional theme switcher display)
  let isHome = $derived(page.url.pathname === "/");

  // Navigation links configuration
  const links = [
    { href: "/", label: "Home" },
    { href: "/gallery", label: "Gallery" },
    { href: "/blog", label: "Blog" },
    { href: "/shop", label: "Shop" },
    { href: "/about", label: "About" },
  ];
</script>

<!-- Desktop nav - hidden on mobile (md:flex), centered with max-width -->
<nav
  class="hidden md:flex w-full items-center justify-between px-8 py-6 max-w-[1400px] !mx-auto border-b border-surface-500/20"
>
  <!-- Site title/logo -->
  <a href="/" class="text-sm tracking-widest lowercase font-light text-gray-900 dark:text-surface-50"
    >angel's rest</a
  >
  
  <div class="flex items-center gap-8">
    <!-- Navigation links -->
    <ul class="flex gap-8 list-none">
      {#each links as link}
        <li>
          <!-- 
            Active state: exact match for home ("/"), prefix match for other routes
            Colors: gray-900/600 for light mode (explicit), surface-50/400 for dark mode
          -->
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
    
    <!-- Theme switcher - only shown on homepage -->
    {#if isHome}
      <ThemeSwitcher />
    {/if}
  </div>
</nav>
