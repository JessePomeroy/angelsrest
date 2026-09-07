<!--
  Root Layout
  
  Main layout wrapper for all pages. Handles:
  - Desktop nav (hidden on mobile)
  - Mobile header gif (hidden on desktop, not shown on homepage)
  - Mobile theme switcher (only on homepage)
  - Mobile bottom nav with spacer
  - Footer (desktop only)
-->

<svelte:head>
  <meta property="og:title" content={ogTitle} />
  <meta property="og:description" content={ogDesc} />
  <meta property="og:image" content={ogImage} />
  <meta property="og:url" content="https://www.angelsrest.online" />
  <meta property="og:type" content="website" />
  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:image" content={ogImage} />
  <link rel="icon" type="image/png" href="/favicon.png" />
</svelte:head>

<script lang="ts">
import { injectAnalytics } from "@vercel/analytics/sveltekit";
import type { LayoutProps } from "./$types";
import { onMount, setContext } from "svelte";
import { MOBILE_CHROME, type MobileChrome } from "$lib/components/mobileNavigation";

import { page } from "$app/state";
import { filterPrivateCapabilityAnalytics } from "$lib/capabilityPrivacy";

import BottomNav from "$lib/components/BottomNav.svelte";
import CartDrawer from "$lib/components/cart/CartDrawer.svelte";
import GradientBackground from "$lib/components/GradientBackground.svelte";
import GrainOverlay from "$lib/components/GrainOverlay.svelte";
import MobileNav from "$lib/components/MobileNav.svelte";
import Footer from "$lib/components/Footer.svelte";
// Layout components
import Nav from "$lib/components/Nav.svelte";
import ThemeSwitcher from "$lib/components/ThemeSwitcher.svelte";
import Toaster from "$lib/components/Toaster.svelte";

// Time-aware theming
import { getTimeTheme } from "$lib/stores/timeTheme.svelte";

import "$lib/styles/global.css";

const mobileChrome = $state<MobileChrome>({ bottomNavHeight: undefined, purchaseBarHeight: 0 });
setContext(MOBILE_CHROME, mobileChrome);


let { children, data }: LayoutProps = $props();

let isPortal = $derived(page.url.pathname.startsWith("/portal"));
let isAdmin = $derived(page.url.pathname.startsWith("/admin"));

const ogTitle = $derived(data.siteSettings?.siteTitle || "Angel's Rest");
const ogDesc = $derived(
	data.siteSettings?.seo?.description || "Photography by Jesse Pomeroy",
);
const ogImage = $derived(
	data.siteSettings?.seo?.ogImageUrl ||
		"https://www.angelsrest.online/og-image.png",
);

const timeTheme = getTimeTheme();

// Vercel analytics
injectAnalytics({ beforeSend: filterPrivateCapabilityAnalytics });

// Keep time period in sync reactively
$effect(() => {
	// This runs whenever timeTheme.period changes
	timeTheme.apply();
});

onMount(() => {
	return () => {
		timeTheme.destroy();
	};
});
</script>

<svelte:body class:admin-route={isAdmin} class:portal-route={isPortal} />

{#if isPortal}
  {@render children()}
{:else if isAdmin}
  {@render children()}
  <BottomNav />
{:else}
  <!-- Dynamic gradient background — cursor-reactive on desktop, drifting on mobile -->
  <GradientBackground />

  <!-- WebGL film grain — per-pixel noise, no tiling -->
  <GrainOverlay />

  <a href="#main-content" class="skip-link">Skip to content</a>

  <div class="site-shell"
    style:--mobile-nav-height={mobileChrome.bottomNavHeight === undefined ? undefined : `${mobileChrome.bottomNavHeight}px`}
    style:--mobile-purchase-safe-area={mobileChrome.bottomNavHeight === 0 ? "env(safe-area-inset-bottom)" : "0px"}
  >
    <!-- Desktop navigation (hidden on mobile) -->
    <Nav />

    <!-- Main content area -->
    <main
      id="main-content"
      class="site-content"
    >
      {@render children()}
    </main>

    <!-- Desktop footer (hidden on mobile) -->
    <Footer siteSettings={data.siteSettings} />

    <!-- Mobile theme toggle - fixed position above bottom nav, homepage only -->
    {#if page.url.pathname === "/"}
      <div class="mobile-theme-switcher">
        <ThemeSwitcher />
      </div>
    {/if}

    <MobileNav />
  </div>
{/if}

<!--
  Cart drawer — mounted once at the layout root so any CartIcon (desktop nav,
  mobile pill) can open it via the cartUI store. Skipped on portal/admin
  routes since they don't share the public site chrome.
-->
{#if !isPortal && !isAdmin}
  <CartDrawer />
{/if}

<!-- Audit M16: non-blocking toast stack, replaces alert() in shop / delivery. -->
<Toaster />

<style>
.site-shell {
  display: flex;
  flex-direction: column;
  min-height: 100vh;
  position: relative;
  z-index: 10;
}
.site-content {
  flex: 1;
  max-width: 1400px;
  margin-inline: auto;
  width: 100%;
  padding: 1.5rem 1rem 2rem;
}
.mobile-theme-switcher {
  position: fixed;
  bottom: 5rem;
  right: 1rem;
  z-index: 40;
}
@media (min-width: 48rem) {
  .site-content { padding: 2rem 2.5rem 3rem; }
  .mobile-theme-switcher { display: none; }
}

.skip-link {
  position: absolute;
  left: -9999px;
  top: 0;
  z-index: 999;
  padding: 8px 16px;
  background: var(--color-surface-100);
  color: var(--color-surface-900);
}
.skip-link:focus {
  left: 8px;
  top: 8px;
}
</style>
