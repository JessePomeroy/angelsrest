<script lang="ts">
import { addToast, getAdminConfig, PlatformPage, type PlatformClient } from "@jessepomeroy/admin";
import { useQuery } from "convex-svelte";
import { stripeConnectSetupPath } from "$lib/stripeConnectSetup";

type StripePlatformClient = PlatformClient & {
	stripeConnectedAccountId?: string | null;
	role?: "creator" | "client";
};

const config = getAdminConfig();
const { api } = config;

let { data } = $props();

const clientsQuery = useQuery(api.platform.listAll, {});

let selectedSiteUrl = $state("");
let copiedUrl = $state("");

let clients = $derived(((clientsQuery.data ?? []) as StripePlatformClient[]).filter(
	client => client.role !== "creator" && client.siteUrl !== config.siteUrl,
));
let selectedClient = $derived(
	clients.find((client) => client.siteUrl === selectedSiteUrl) ?? null,
);
let startedCount = $derived(
	clients.filter((client) => Boolean(client.stripeConnectedAccountId)).length,
);
let setupUrl = $derived(selectedClient
	? `${data.stripeConnectOrigin}${stripeConnectSetupPath(selectedClient.siteUrl)}`
	: "");

async function copySetupLink() {
	const url = setupUrl;
	if (!url) return;
	try {
		await navigator.clipboard.writeText(url);
		copiedUrl = url;
	} catch {
		addToast("Copying did not work. Select the setup link and copy it.");
	}
}
</script>

<section class="stripe-panel" aria-labelledby="stripe-connect-heading">
	<div class="stripe-copy">
		<p class="eyebrow">payments</p>
		<h2 id="stripe-connect-heading">Stripe Connect</h2>
		<p>
			Share the client's setup page. They sign in with their website admin login
			and enter their business and bank details directly with Stripe.
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
				<option value="">choose a client</option>
				{#each clients as client (client._id)}
					<option value={client.siteUrl}>
						{client.name} — {client.stripeConnectedAccountId ? "setup started" : "not started"}
					</option>
				{/each}
			{/if}
		</select>

		{#if data.stripeConnectOnboardingEnabled}
		<button
			type="button"
			class="connect-button"
			disabled={!selectedClient}
			onclick={copySetupLink}
		>
			{setupUrl && copiedUrl === setupUrl ? "link copied" : "copy client setup link"}
		</button>
		{#if setupUrl}
			<label for="stripe-setup-link">client setup link</label>
			<input id="stripe-setup-link" class="setup-link" readonly value={setupUrl} onfocus={(event) => event.currentTarget.select()} />
			<a href={setupUrl}>open setup page</a>
		{/if}
		{:else}
			<p class="setup-note">Client payment setup is not open yet.</p>
		{/if}
	</div>

	<div class="stripe-status" aria-live="polite">
		<span>{startedCount} / {clients.length} setup started</span>
		<span>Readiness is checked on each client's setup page.</span>
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
	.setup-link,
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
	.setup-link { width: 100%; min-width: 0; padding: 8px 12px; border: 1px solid var(--admin-border); color: var(--admin-text); background: var(--admin-surface); }
	.setup-note { margin: 0; color: var(--admin-text-muted); font-size: .85rem; line-height: 1.5; }
	.stripe-controls a { color: var(--admin-text-muted); text-underline-offset: 4px; }

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
