<script lang="ts">
import { page } from "$app/stores";

let { children } = $props();

let mobileMenuOpen = $state(false);

const navItems = [
	{ href: "/admin", label: "Dashboard", icon: "grid" },
	{ href: "/admin/orders", label: "Orders", icon: "package" },
	{ href: "/admin/inquiries", label: "Inquiries", icon: "mail" },
	{ href: "/admin/galleries", label: "Galleries", icon: "image" },
	{ href: "/admin/crm", label: "Clients", icon: "clients" },
];

function isActive(href: string, pathname: string): boolean {
	if (href === "/admin") return pathname === "/admin";
	return pathname.startsWith(href);
}

function closeMobileMenu() {
	mobileMenuOpen = false;
}
</script>

<div class="admin-layout">
	<!-- Mobile header -->
	<header class="mobile-header">
		<button class="hamburger" onclick={() => (mobileMenuOpen = !mobileMenuOpen)} aria-label="Toggle menu">
			<span class="hamburger-line" class:open={mobileMenuOpen}></span>
			<span class="hamburger-line" class:open={mobileMenuOpen}></span>
			<span class="hamburger-line" class:open={mobileMenuOpen}></span>
		</button>
		<span class="mobile-brand">Angel's Rest</span>
	</header>

	<!-- Mobile overlay -->
	{#if mobileMenuOpen}
		<button class="mobile-overlay" onclick={closeMobileMenu} aria-label="Close menu"></button>
	{/if}

	<!-- Sidebar -->
	<aside class="sidebar" class:sidebar-open={mobileMenuOpen}>
		<div class="sidebar-brand">
			<span class="brand-text">Angel's Rest</span>
			<span class="brand-sub">Admin</span>
		</div>

		<nav class="sidebar-nav">
			{#each navItems as item}
				<a
					href={item.href}
					class="nav-item"
					class:active={isActive(item.href, $page.url.pathname)}
					onclick={closeMobileMenu}
				>
					<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
						{#if item.icon === "grid"}
							<rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /><rect x="14" y="14" width="7" height="7" />
						{:else if item.icon === "package"}
							<path d="M16.5 9.4l-9-5.19M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z" /><polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" />
						{:else if item.icon === "mail"}
							<path d="M4 4h16c1.1 0 2 .9 2 2v12c0 1.1-.9 2-2 2H4c-1.1 0-2-.9-2-2V6c0-1.1.9-2 2-2z" /><polyline points="22,6 12,13 2,6" />
						{:else if item.icon === "image"}
							<rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" />
						{:else if item.icon === "clients"}
							<path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
						{/if}
					</svg>
					<span>{item.label}</span>
				</a>
			{/each}
		</nav>

		<div class="sidebar-footer">
			<a href="/" class="back-link">
				<svg class="nav-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
					<line x1="19" y1="12" x2="5" y2="12" /><polyline points="12 19 5 12 12 5" />
				</svg>
				<span>Back to site</span>
			</a>
		</div>
	</aside>

	<!-- Main content -->
	<main class="admin-main">
		{@render children()}
	</main>
</div>

<style>
	.admin-layout {
		--admin-bg: #1a1f2e;
		--admin-surface: #242a3b;
		--admin-surface-raised: #2b3244;
		--admin-border: rgba(255, 255, 255, 0.08);
		--admin-border-strong: rgba(255, 255, 255, 0.14);
		--admin-heading: rgba(255, 255, 255, 0.95);
		--admin-text: rgba(255, 255, 255, 0.82);
		--admin-text-muted: rgba(255, 255, 255, 0.55);
		--admin-text-subtle: rgba(255, 255, 255, 0.35);
		--admin-accent: rgba(255, 255, 255, 0.85);
		--admin-accent-hover: rgba(255, 255, 255, 1);
		--admin-active: rgba(255, 255, 255, 0.08);
		--status-slate: #6b7fa8;
		--status-amber: #b89a5e;
		--status-lavender: #9d7eb3;
		--status-peach: #c48b6a;
		--status-sage: #7ea487;
		--status-rose: #b87c7c;

		display: flex;
		min-height: 100vh;
		background: var(--admin-bg);
		color: var(--admin-text);
	}

	/* Mobile header */
	.mobile-header {
		display: none;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 56px;
		background: var(--admin-surface);
		border-bottom: 1px solid var(--admin-border);
		align-items: center;
		padding: 0 16px;
		z-index: 40;
		gap: 12px;
	}

	.mobile-brand {
		font-size: 1.05rem;
		font-weight: 600;
		color: var(--admin-heading);
		letter-spacing: 0.02em;
	}

	.hamburger {
		display: flex;
		flex-direction: column;
		gap: 5px;
		background: none;
		border: none;
		cursor: pointer;
		padding: 4px;
	}

	.hamburger-line {
		width: 22px;
		height: 2px;
		background: var(--admin-text);
		border-radius: 1px;
		transition: transform 0.2s, opacity 0.2s;
	}

	.hamburger-line.open:nth-child(1) {
		transform: translateY(7px) rotate(45deg);
	}

	.hamburger-line.open:nth-child(2) {
		opacity: 0;
	}

	.hamburger-line.open:nth-child(3) {
		transform: translateY(-7px) rotate(-45deg);
	}

	.mobile-overlay {
		display: none;
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.5);
		z-index: 45;
	}

	/* Sidebar */
	.sidebar {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		width: 240px;
		background: var(--admin-surface);
		border-right: 1px solid var(--admin-border);
		display: flex;
		flex-direction: column;
		z-index: 50;
	}

	.sidebar-brand {
		padding: 24px 20px 20px;
		border-bottom: 1px solid var(--admin-border);
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.brand-text {
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--admin-heading);
		letter-spacing: 0.02em;
	}

	.brand-sub {
		font-size: 0.75rem;
		color: var(--admin-text-subtle);
		text-transform: uppercase;
		letter-spacing: 0.1em;
	}

	.sidebar-nav {
		flex: 1;
		padding: 12px 8px;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 6px;
		color: var(--admin-text-muted);
		text-decoration: none;
		font-size: 0.9rem;
		transition: color 0.15s, background 0.15s;
	}

	.nav-item:hover {
		color: var(--admin-accent-hover);
		background: var(--admin-active);
	}

	.nav-item.active {
		color: var(--admin-heading);
		background: var(--admin-active);
	}

	.nav-icon {
		width: 18px;
		height: 18px;
		flex-shrink: 0;
	}

	.sidebar-footer {
		padding: 12px 8px;
		border-top: 1px solid var(--admin-border);
	}

	.back-link {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 6px;
		color: var(--admin-text-subtle);
		text-decoration: none;
		font-size: 0.85rem;
		transition: color 0.15s, background 0.15s;
	}

	.back-link:hover {
		color: var(--admin-accent-hover);
		background: var(--admin-active);
	}

	/* Main content */
	.admin-main {
		flex: 1;
		margin-left: 240px;
		min-height: 100vh;
	}

	/* Mobile responsive */
	@media (max-width: 768px) {
		.mobile-header {
			display: flex;
		}

		.mobile-overlay {
			display: block;
		}

		.sidebar {
			transform: translateX(-100%);
			transition: transform 0.25s ease;
		}

		.sidebar-open {
			transform: translateX(0);
		}

		.admin-main {
			margin-left: 0;
			padding-top: 56px;
		}
	}
</style>
