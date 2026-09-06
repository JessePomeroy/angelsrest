<script lang="ts">
import {
	HouseIcon,
	ImageIcon,
	PencilLineIcon,
	ShoppingBagIcon,
	UserIcon,
} from "@lucide/svelte";
import { page } from "$app/state";

const links = [
	{ label: "Home", href: "/", icon: HouseIcon },
	{ label: "Gallery", href: "/gallery", icon: ImageIcon },
	{ label: "Blog", href: "/blog", icon: PencilLineIcon },
	{ label: "Shop", href: "/shop", icon: ShoppingBagIcon },
	{ label: "About", href: "/about", icon: UserIcon },
];
</script>

<nav
  aria-label="Mobile navigation"
  class="sticky bottom-0 z-50 border-t border-surface-300 bg-surface-50 pb-[env(safe-area-inset-bottom)] dark:border-surface-700 dark:bg-surface-900 md:hidden"
>
  <ul class="grid grid-cols-5 gap-1 p-1">
    {#each links as link (link.href)}
      {@const Icon = link.icon}
      {@const active = page.url.pathname === link.href || (link.href !== '/' && page.url.pathname.startsWith(`${link.href}/`))}
      <li>
        <a
          href={link.href}
          aria-current={active ? 'page' : undefined}
          class="flex min-h-14 items-center justify-center flex-col gap-1 rounded-md px-1 py-2 text-xs focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-surface-900 dark:focus-visible:outline-surface-50 {active ? 'bg-primary-500 text-slate-950' : 'text-surface-700 hover:bg-surface-200 dark:text-surface-200 dark:hover:bg-surface-700'}"
        >
          <Icon class="size-5" aria-hidden="true" />
          <span>{link.label}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>
