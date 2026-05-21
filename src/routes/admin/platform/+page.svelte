<script lang="ts">
import { addToast, getAdminConfig, PlatformPage, type PlatformClient } from "@jessepomeroy/admin";
import { useQuery } from "@mmailaender/convex-svelte";

type StripePlatformClient = PlatformClient & {
	stripeConnectedAccountId?: string | null;
};

const config = getAdminConfig();
const { api } = config;

let { data } = $props();

const clientsQuery = useQuery(api.platform.listAll, {});

let selectedSiteUrl = $state("");
let onboardingSiteUrl = $state<string | null>(null);

let clients = $derived((clientsQuery.data ?? []) as StripePlatformClient[]);
let selectedClient = $derived(
	clients.find((client) => client.siteUrl === selectedSiteUrl) ?? clients[0] ?? null,
);
let connectedCount = $derived(
	clients.filter((client) => Boolean(client.stripeConnectedAccountId)).length,
);
let onboardingLabel = $derived(
	selectedClient?.stripeConnectedAccountId ? "continue stripe setup" : "connect stripe",
);

$effect(() => {
	if (!selectedSiteUrl && clients[0]) {
		selectedSiteUrl = clients[0].siteUrl;
	}
});

async function startStripeOnboarding() {
	if (!selectedClient || onboardingSiteUrl) return;

	onboardingSiteUrl = selectedClient.siteUrl;
	try {
		const response = await fetch("/api/stripe-connect/onboard", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ siteUrl: selectedClient.siteUrl }),
		});

		if (!response.ok) {
			const message = await response.text();
			throw new Error(message || "Failed to start Stripe onboarding.");
		}

		const result = (await response.json()) as { url?: string };
		if (!result.url) {
			throw new Error("Stripe did not return an onboarding link.");
		}

		window.location.href = result.url;
	} catch (error) {
		console.error(error);
		addToast("Failed to start Stripe onboarding.");
		onboardingSiteUrl = null;
	}
}
</script>

<section class="stripe-panel" aria-labelledby="stripe-connect-heading">
	<div class="stripe-copy">
		<p class="eyebrow">payments</p>
		<h2 id="stripe-connect-heading">Stripe Connect</h2>
		<p>
			Route print checkout through a client's connected Stripe account while keeping
			Angels Rest's platform fee on print orders.
		</p>
	</div>

	<div class="stripe-controls">
		<label for="stripe-client">client</label>
		<select id="stripe-client" bind:value={selectedSiteUrl} disabled={clientsQuery.isLoading || clients.length === 0}>
			{#if clientsQuery.isLoading}
				<option value="">loading clients...</option>
			{:else if clients.length === 0}
				<option value="">no clients available</option>
			{:else}
				{#each clients as client (client._id)}
					<option value={client.siteUrl}>
						{client.name} — {client.stripeConnectedAccountId ? "connected" : "not connected"}
					</option>
				{/each}
			{/if}
		</select>

		<button
			type="button"
			class="connect-button"
			disabled={!selectedClient || Boolean(onboardingSiteUrl)}
			onclick={startStripeOnboarding}
		>
			{onboardingSiteUrl ? "opening stripe..." : onboardingLabel}
		</button>
	</div>

	<div class="stripe-status" aria-live="polite">
		<span>{connectedCount} / {clients.length} connected</span>
		{#if selectedClient?.stripeConnectedAccountId}
			<span class="account-id">{selectedClient.stripeConnectedAccountId}</span>
		{/if}
	</div>
</section>

<PlatformPage {data} />

<style>
	.stripe-panel {
		display: grid;
		grid-template-columns: minmax(0, 1fr) minmax(260px, 360px) auto;
		align-items: end;
		gap: 24px;
		max-width: 1200px;
		margin: 40px 40px 0;
		padding: 24px;
		border: 1px solid var(--admin-border);
		border-radius: 8px;
		background: var(--admin-surface);
		color: var(--admin-text);
	}

	.stripe-copy {
		display: grid;
		gap: 8px;
	}

	.eyebrow {
		margin: 0;
		color: var(--admin-text-subtle);
		font-size: 0.72rem;
		letter-spacing: 0.08em;
		text-transform: uppercase;
	}

	.stripe-copy h2 {
		margin: 0;
		color: var(--admin-heading);
		font-family: "Chillax", sans-serif;
		font-size: 1.2rem;
		font-weight: 500;
	}

	.stripe-copy p:not(.eyebrow) {
		max-width: 56ch;
		margin: 0;
		color: var(--admin-text-muted);
		font-size: 0.86rem;
		line-height: 1.55;
	}

	.stripe-controls {
		display: grid;
		gap: 8px;
	}

	.stripe-controls label {
		color: var(--admin-text-subtle);
		font-size: 0.74rem;
		letter-spacing: 0.04em;
	}

	.stripe-controls select,
	.connect-button {
		min-height: 40px;
		border-radius: 6px;
		font: inherit;
	}

	.stripe-controls select {
		width: 100%;
		padding: 0 12px;
		border: 1px solid var(--admin-border-strong);
		background: transparent;
		color: var(--admin-text);
	}

	.connect-button {
		padding: 0 16px;
		border: 1px solid var(--admin-border-strong);
		background: var(--admin-heading);
		color: var(--admin-bg);
		cursor: pointer;
		white-space: nowrap;
	}

	.connect-button:disabled {
		cursor: not-allowed;
		opacity: 0.55;
	}

	.stripe-status {
		display: grid;
		gap: 6px;
		color: var(--admin-text-muted);
		font-size: 0.82rem;
		text-align: right;
	}

	.account-id {
		color: var(--admin-text-subtle);
		font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
		font-size: 0.72rem;
	}

	@media (max-width: 900px) {
		.stripe-panel {
			grid-template-columns: 1fr;
			align-items: stretch;
		}

		.stripe-status {
			text-align: left;
		}
	}

	@media (max-width: 640px) {
		.stripe-panel {
			margin: 24px 20px 0;
			padding: 20px;
		}
	}
</style>
