<script lang="ts">
import type { Feature } from "$lib/admin/features";

interface Props {
	feature: Feature;
	platformUrl?: string;
	siteUrl?: string;
	clientEmail?: string;
}

let {
	feature,
	platformUrl = "",
	siteUrl = "",
	clientEmail = "",
}: Props = $props();

let loading = $state(false);
let error = $state("");

const featureLabels: Record<Feature, string> = {
	dashboard: "dashboard",
	orders: "orders",
	inquiries: "inquiries",
	galleries: "galleries",
	crm: "client management",
	invoicing: "invoicing",
	quotes: "quotes",
	contracts: "contracts",
	emails: "email templates",
	messages: "messaging",
};

async function handleUpgrade() {
	loading = true;
	error = "";
	try {
		const base = platformUrl || "";
		const res = await fetch(`${base}/api/platform/create-checkout`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ clientEmail: clientEmail, siteUrl: siteUrl }),
		});
		if (!res.ok) {
			throw new Error("failed to create checkout session");
		}
		const { url } = await res.json();
		window.location.href = url;
	} catch (e) {
		error = "something went wrong. please try again.";
		loading = false;
	}
}
</script>

<div class="upgrade-banner">
	<div class="upgrade-content">
		<svg class="upgrade-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
			<path d="M12 2L2 7l10 5 10-5-10-5z" />
			<path d="M2 17l10 5 10-5" />
			<path d="M2 12l10 5 10-5" />
		</svg>
		<h3 class="upgrade-title">unlock {featureLabels[feature]}</h3>
		<p class="upgrade-description">
			upgrade to full crm for client management, invoicing, quotes, contracts, and more.
		</p>
		{#if error}
			<p class="upgrade-error">{error}</p>
		{/if}
		<button class="upgrade-button" onclick={handleUpgrade} disabled={loading}>
			{loading ? "redirecting..." : "upgrade to full crm"}
		</button>
	</div>
</div>

<style>
	.upgrade-banner {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 60vh;
		padding: 48px 24px;
	}

	.upgrade-content {
		text-align: center;
		max-width: 400px;
	}

	.upgrade-icon {
		width: 40px;
		height: 40px;
		color: var(--admin-accent);
		margin-bottom: 20px;
		opacity: 0.7;
	}

	.upgrade-title {
		font-family: "Chillax", sans-serif;
		font-size: 1.3rem;
		font-weight: 500;
		color: var(--admin-heading);
		margin: 0 0 10px;
	}

	.upgrade-description {
		font-size: 0.88rem;
		color: var(--admin-text-muted);
		line-height: 1.6;
		margin: 0 0 28px;
	}

	.upgrade-error {
		font-size: 0.82rem;
		color: var(--status-rose);
		margin: 0 0 16px;
	}

	.upgrade-button {
		background: var(--admin-accent);
		color: #fff;
		border: none;
		padding: 10px 28px;
		border-radius: 6px;
		font-family: "Synonym", system-ui, sans-serif;
		font-size: 0.88rem;
		font-weight: 500;
		cursor: pointer;
		transition: opacity 0.15s;
		text-transform: lowercase;
	}

	.upgrade-button:hover:not(:disabled) {
		opacity: 0.85;
	}

	.upgrade-button:disabled {
		opacity: 0.5;
		cursor: not-allowed;
	}
</style>
