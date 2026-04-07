<script lang="ts">
import { page } from "$app/stores";

let { children } = $props();

let mobileMenuOpen = $state(false);

const navItems = [
	{ href: "/admin", label: "dashboard", icon: "grid" },
	{ href: "/admin/orders", label: "orders", icon: "package" },
	{ href: "/admin/inquiries", label: "inquiries", icon: "mail" },
	{ href: "/admin/galleries", label: "galleries", icon: "image" },
	{ href: "/admin/crm", label: "clients", icon: "clients" },
	{ href: "/admin/invoicing", label: "invoicing", icon: "invoicing" },
	{ href: "/admin/quotes", label: "quotes", icon: "quotes" },
	{ href: "/admin/contracts", label: "contracts", icon: "contracts" },
	{ href: "/admin/emails", label: "emails", icon: "emails" },
	{ href: "/admin/messages", label: "messages", icon: "messages" },
	{
		href: "/admin/platform",
		label: "platform",
		icon: "platform",
		separator: true,
	},
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
		<span class="mobile-brand">angel's rest</span>
	</header>

	<!-- Mobile overlay -->
	{#if mobileMenuOpen}
		<button class="mobile-overlay" onclick={closeMobileMenu} aria-label="Close menu"></button>
	{/if}

	<!-- Sidebar -->
	<aside class="sidebar" class:sidebar-open={mobileMenuOpen}>
		<div class="sidebar-brand">
			<span class="brand-text">angel's rest</span>
		</div>

		<nav class="sidebar-nav">
			{#each navItems as item}
				{#if item.separator}
					<div class="nav-separator"></div>
				{/if}
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
						{:else if item.icon === "invoicing"}
							<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><polyline points="10 9 9 9 8 9"/>
						{:else if item.icon === "quotes"}
						<path d="M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z"/>
					{:else if item.icon === "contracts"}
							<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>
						{:else if item.icon === "emails"}
							<rect x="2" y="4" width="20" height="16" rx="2"/><path d="M22 7l-10 7L2 7"/>
						{:else if item.icon === "messages"}
							<path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/>
						{:else if item.icon === "platform"}
							<circle cx="12" cy="12" r="10"/><line x1="2" y1="12" x2="22" y2="12"/><path d="M12 2a15.3 15.3 0 014 10 15.3 15.3 0 01-4 10 15.3 15.3 0 01-4-10 15.3 15.3 0 014-10z"/>
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
				<span>back to site</span>
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
		--admin-bg: #1e293b;
		--admin-surface: rgba(255, 255, 255, 0.03);
		--admin-surface-raised: rgba(255, 255, 255, 0.05);
		--admin-border: rgba(255, 255, 255, 0.06);
		--admin-border-strong: rgba(255, 255, 255, 0.1);
		--admin-heading: rgba(255, 255, 255, 0.92);
		--admin-text: rgba(255, 255, 255, 0.72);
		--admin-text-muted: rgba(255, 255, 255, 0.45);
		--admin-text-subtle: rgba(255, 255, 255, 0.28);
		--admin-accent: #818cf8;
		--admin-accent-hover: #a5b4fc;
		--admin-active: rgba(129, 140, 248, 0.08);
		--status-slate: #94a3b8;
		--status-amber: #d4a053;
		--status-lavender: #a78bfa;
		--status-peach: #c48b6a;
		--status-sage: #6ee7b7;
		--status-rose: #f87171;

		display: flex;
		min-height: 100vh;
		background: var(--admin-bg);
		color: var(--admin-text);
		font-family: "Synonym", system-ui, sans-serif;
		text-transform: lowercase;
	}

	/* Mobile header */
	.mobile-header {
		display: none;
		position: fixed;
		top: 0;
		left: 0;
		right: 0;
		height: 56px;
		background: var(--admin-bg);
		border-bottom: 1px solid var(--admin-border);
		align-items: center;
		padding: 0 20px;
		z-index: 40;
		gap: 14px;
	}

	.mobile-brand {
		font-family: "Chillax", sans-serif;
		font-size: 1.05rem;
		font-weight: 500;
		color: var(--admin-heading);
		letter-spacing: 0.01em;
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
		width: 20px;
		height: 1.5px;
		background: var(--admin-text-muted);
		border-radius: 1px;
		transition: transform 0.2s, opacity 0.2s;
	}

	.hamburger-line.open:nth-child(1) {
		transform: translateY(6.5px) rotate(45deg);
	}

	.hamburger-line.open:nth-child(2) {
		opacity: 0;
	}

	.hamburger-line.open:nth-child(3) {
		transform: translateY(-6.5px) rotate(-45deg);
	}

	.mobile-overlay {
		display: none;
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.4);
		backdrop-filter: blur(4px);
		z-index: 45;
	}

	/* Sidebar */
	.sidebar {
		position: fixed;
		top: 0;
		left: 0;
		bottom: 0;
		width: 220px;
		background: var(--admin-bg);
		border-right: 1px solid var(--admin-border);
		display: flex;
		flex-direction: column;
		z-index: 50;
	}

	.sidebar-brand {
		padding: 28px 24px 24px;
	}

	.brand-text {
		font-family: "Chillax", sans-serif;
		font-size: 1.15rem;
		font-weight: 500;
		color: var(--admin-heading);
		letter-spacing: 0.01em;
	}

	.sidebar-nav {
		flex: 1;
		padding: 8px 12px;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}

	.nav-separator {
		height: 1px;
		background: var(--admin-border);
		margin: 8px 12px;
	}

	.nav-item {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 6px;
		color: var(--admin-text-muted);
		text-decoration: none;
		font-family: "Synonym", system-ui, sans-serif;
		font-size: 0.88rem;
		font-weight: 400;
		letter-spacing: 0.01em;
		transition: color 0.15s;
	}

	.nav-item:hover {
		color: var(--admin-heading);
	}

	.nav-item.active {
		color: var(--admin-heading);
		font-weight: 500;
	}

	.nav-icon {
		width: 17px;
		height: 17px;
		flex-shrink: 0;
		opacity: 0.7;
	}

	.nav-item.active .nav-icon {
		opacity: 1;
	}

	.sidebar-footer {
		padding: 16px 12px;
	}

	.back-link {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 10px 12px;
		border-radius: 6px;
		color: var(--admin-text-subtle);
		text-decoration: none;
		font-family: "Synonym", system-ui, sans-serif;
		font-size: 0.82rem;
		transition: color 0.15s;
	}

	.back-link:hover {
		color: var(--admin-text);
	}

	/* Main content */
	.admin-main {
		flex: 1;
		margin-left: 220px;
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
