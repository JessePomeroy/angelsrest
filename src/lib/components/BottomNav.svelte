<!--
  Mobile Bottom Navigation
  
  - Sticky footer nav for mobile (hidden on desktop with md:hidden)
  - Uses Skeleton's Navigation component with bar layout
  - 5-column grid for nav items with Lucide icons
  - 'bottom-nav' class used for light mode styling overrides in global.css
-->

<script lang="ts">
  import { page } from "$app/state";
  import {
    HouseIcon,
    ImageIcon,
    PencilLineIcon,
    ShoppingBagIcon,
    UserIcon,
  } from "@lucide/svelte";
  import { Navigation } from "@skeletonlabs/skeleton-svelte";

  // Navigation links with icons
  const links = [
    { label: "Home", href: "/", icon: HouseIcon },
    { label: "Gallery", href: "/gallery", icon: ImageIcon  },
    { label: "Blog", href: "/blog", icon: PencilLineIcon },
    { label: "Shop", href: "/shop", icon: ShoppingBagIcon },
    { label: "About", href: "/about", icon: UserIcon },
  ];
</script>

<!-- 
  Mobile nav bar - sticky to bottom, hidden on desktop
  'bottom-nav' class is targeted in global.css for light mode color overrides
-->
<div class="sticky bottom-0 left-0 right-0 z-50 md:hidden bottom-nav">
  <Navigation layout="bar">
    <Navigation.Menu class="grid grid-cols-5 gap-1">
      {#each links as link (link.href)}
        {@const Icon = link.icon}
        <Navigation.TriggerAnchor href={link.href}>
          <Icon class="size-5" />
          <Navigation.TriggerText>{link.label}</Navigation.TriggerText>
        </Navigation.TriggerAnchor>
      {/each}
    </Navigation.Menu>
  </Navigation>
</div>
