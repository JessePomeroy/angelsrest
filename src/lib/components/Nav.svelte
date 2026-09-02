<!--
  Desktop Navigation Component
  
  - Only visible on md+ screens (hidden on mobile, which uses BottomNav)
  - Theme switcher visible on all pages (desktop)
  - Uses gray colors for light mode (better contrast than theme surface colors)
  - Active link detection supports both exact match and prefix match for nested routes
-->

<script lang="ts">
import { page } from "$app/state";
import CartIcon from "./cart/CartIcon.svelte";
import ThemeSwitcher from "./ThemeSwitcher.svelte";

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
<nav aria-label="Main navigation" class="site-nav">
  <!-- Site title/logo -->
  <a href="/" class="site-name">angel's rest</a>
  
  <div class="nav-cluster">
    <!-- Navigation links -->
    <ul class="nav-links">
      {#each links as link (link.href)}
        <li>
          <!-- 
            Active state: exact match for home ("/"), prefix match for other routes
            Colors: gray-900/600 for light mode (explicit), surface-50/400 for dark mode
          -->
          <a
            href={link.href}
            class:active={page.url.pathname === link.href ||
              (link.href !== '/' && page.url.pathname.startsWith(link.href))}
          >
            {link.label}
          </a>
        </li>
      {/each}
    </ul>
    
    <!-- Theme switcher - visible on all pages (desktop) -->
    <ThemeSwitcher />

    <!-- Cart icon - opens drawer; badge shows live item count -->
    <CartIcon variant="nav" />
  </div>
</nav>

<style>
  .site-nav {
    display: none;
    width: min(100%, 1400px);
    height: 64px;
    margin-inline: auto;
    padding-inline: clamp(2.5rem, 4vw, 4rem);
    align-items: center;
    justify-content: space-between;
    border-bottom: 1px solid color-mix(in srgb, currentColor 14%, transparent);
  }

  .site-name {
    color: inherit;
    font-size: 0.78rem;
    font-weight: 500;
    letter-spacing: 0.18em;
  }

  .nav-cluster,
  .nav-links {
    display: flex;
    align-items: center;
  }

  .nav-cluster { gap: 2rem; }
  .nav-links { gap: clamp(1.25rem, 2.5vw, 2rem); }

  .nav-links a {
    position: relative;
    display: block;
    padding-block: 22px 20px;
    color: color-mix(in srgb, currentColor 64%, transparent);
    font-size: 0.72rem;
    letter-spacing: 0.12em;
  }

  .nav-links a::after {
    content: "";
    position: absolute;
    right: 0;
    bottom: -1px;
    left: 0;
    height: 1px;
    background: var(--time-accent);
    transform: scaleX(0);
    transition: transform 180ms ease;
  }

  .nav-links a:hover,
  .nav-links a.active { color: currentColor; }
  .nav-links a.active::after { transform: scaleX(1); }

  @media (min-width: 768px) {
    .site-nav { display: flex; }
  }
</style>
