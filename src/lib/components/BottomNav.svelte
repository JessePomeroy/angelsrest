<script lang="ts">
import { getContext } from "svelte";
import { MOBILE_CHROME, type MobileChrome } from "./mobileNavigation";

import {
	HouseIcon,
	ImageIcon,
	PencilLineIcon,
	ShoppingBagIcon,
	UserIcon,
} from "@lucide/svelte";
import { page } from "$app/state";

const chrome = getContext<MobileChrome | undefined>(MOBILE_CHROME);
let navSize = $state<ResizeObserverSize[]>();
$effect(() => {
	if (chrome && navSize?.[0]) chrome.bottomNavHeight = navSize[0].blockSize;
});


const links = [
	{ label: "Home", href: "/", icon: HouseIcon },
	{ label: "Gallery", href: "/gallery", icon: ImageIcon },
	{ label: "Blog", href: "/blog", icon: PencilLineIcon },
	{ label: "Shop", href: "/shop", icon: ShoppingBagIcon },
	{ label: "About", href: "/about", icon: UserIcon },
];
</script>

<nav
  bind:borderBoxSize={navSize}
  aria-label="Mobile navigation"
  class="bottom-nav"
>
  <ul>
    {#each links as link (link.href)}
      {@const Icon = link.icon}
      {@const active = page.url.pathname === link.href || (link.href !== '/' && page.url.pathname.startsWith(`${link.href}/`))}
      <li>
        <a
          href={link.href}
          aria-current={active ? 'page' : undefined}
        >
          <Icon size="1.25rem" aria-hidden="true" />
          <span>{link.label}</span>
        </a>
      </li>
    {/each}
  </ul>
</nav>

<style>
  .bottom-nav {
    position: sticky;
    bottom: 0;
    z-index: 50;
    border-top: 1px solid var(--time-border, var(--color-surface-300));
    background: var(--color-surface-50);
    padding-bottom: env(safe-area-inset-bottom);
  }
  ul {
    display: grid;
    grid-template-columns: repeat(5, minmax(0, 1fr));
    gap: 0.25rem;
    padding: 0;
  }
  a {
    display: flex;
    min-height: 3.5rem;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 0.25rem;
    border-radius: 0;
    padding: 0.5rem 0.25rem;
    font-size: var(--text-xs);
    line-height: var(--text-xs--line-height);
    color: var(--color-surface-700);
  }
  a:focus-visible {
    outline: 2px solid var(--color-surface-900);
    outline-offset: -2px;
  }
  :global(.dark) .bottom-nav {
    border-color: var(--time-border, var(--color-surface-700));
    background: var(--color-surface-900);
  }
  :global(.dark) a { color: var(--color-surface-200); }
  :global(.dark) a:focus-visible { outline-color: var(--color-surface-50); }
  a[aria-current="page"], :global(.dark) a[aria-current="page"] {
    background: var(--color-primary-500);
    color: oklch(12.9% 0.042 264.695);
  }
  @media (hover: hover) {
    a:not([aria-current]):hover { background: var(--color-surface-200); }
    :global(.dark) a:not([aria-current]):hover { background: var(--color-surface-700); }
  }
  @media (min-width: 48rem) { .bottom-nav { display: none; } }
  @media (pointer: coarse) and (orientation: landscape) and (max-height: 500px) { .bottom-nav { display: block; } }
</style>
