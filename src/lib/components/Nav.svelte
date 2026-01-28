<script lang="ts">
	import { page } from '$app/state';

	const links = [
		{ href: '/', label: 'Home' },
		{ href: '/gallery', label: 'Gallery' },
		{ href: '/shop', label: 'Shop' },
		{ href: '/about', label: 'About' },
		{ href: '/contact', label: 'Contact' }
	];
</script>

<nav>
	<a href="/" class="logo">and i still hear angels</a>
	<ul>
		{#each links as link}
			<li>
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
</nav>

<style>
	nav {
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 1.5rem 2rem;
		max-width: var(--max-width);
		margin: 0 auto;
		border-bottom: 1px solid var(--color-border);
	}

	.logo {
		font-size: 0.85rem;
		letter-spacing: 0.15em;
		text-transform: lowercase;
		font-weight: 300;
		color: var(--color-text);
	}

	ul {
		display: flex;
		gap: 2rem;
		list-style: none;
	}

	a {
		font-size: 0.8rem;
		letter-spacing: 0.1em;
		text-transform: uppercase;
		color: var(--color-text-muted);
		transition: color var(--transition);
	}

	a:hover,
	a.active {
		color: var(--color-text);
		opacity: 1;
	}

	@media (max-width: 640px) {
		nav {
			flex-direction: column;
			gap: 1rem;
			padding: 1rem;
		}
		ul {
			gap: 1.25rem;
		}
	}
</style>
