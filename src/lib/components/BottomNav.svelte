<script lang="ts">
  import { page } from "$app/state";
  import {
    HouseIcon,
    ImageIcon,
    ShoppingBagIcon,
    UserIcon,
  } from "@lucide/svelte";
  import { Navigation } from "@skeletonlabs/skeleton-svelte";

  const links = [
    { label: "Home", href: "/", icon: HouseIcon },
    { label: "Gallery", href: "/gallery", icon: ImageIcon },
    { label: "Shop", href: "/shop", icon: ShoppingBagIcon },
    { label: "About", href: "/about", icon: UserIcon },
  ];
</script>

<div class="sticky bottom-0 left-0 right-0 z-50 md:hidden">
  <Navigation layout="bar">
    <Navigation.Menu class="grid grid-cols-4 gap-2">
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
