<script lang="ts">
import { lumaprintsSetupPath, type LumaPrintsSetupData } from "$lib/lumaprintsSetup";

let { data, form }: { data: LumaPrintsSetupData; form?: { message?: string; saved?: boolean } | null } = $props();
let connectionRef = $state("");
let accountOwnershipConfirmed = $state(false);
let billingConfirmed = $state(false);
let submitting = $state(false);
const setupPath = $derived(lumaprintsSetupPath(data.siteUrl));
function changeConnection() { accountOwnershipConfirmed = false; billingConfirmed = false; }
</script>

<svelte:head><title>LumaPrints setup · Angels Rest</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<svelte:window onpageshow={() => { submitting = false; }} />

<div class="supplier-page" data-admin>
	<a class="back-link" href="/admin/platform">Back to platform clients</a>
	<header>
		<p class="eyebrow">client print fulfillment</p>
		<h1>Set up LumaPrints</h1>
		<p class="client-name">{data.clientName || data.siteUrl}</p>
		{#if data.clientName}<p class="website">{data.siteUrl}</p>{/if}
	</header>
	{#if form?.message}<p class="notice" role="alert">{form.message}</p>{/if}
	{#if data.status === "available"}
		<p class="intro">Connect the client’s own LumaPrints account and store. LumaPrints will charge the client directly for printing and shipping.</p>
		<form method="POST" action={`${setupPath}?/connect`} aria-busy={submitting} onsubmit={() => { submitting = true; }}>
			<div class="field">
				<label for="supplier-connection">Configured store</label>
				<select id="supplier-connection" name="connectionRef" required bind:value={connectionRef} onchange={changeConnection}>
					<option value="">Choose a store</option>
					{#each data.choices as item (item.connectionRef)}
						<option value={item.connectionRef}>Store {item.storeId} · {item.environment === "production" ? "Production" : "Sandbox"} · {item.connectionRef}</option>
					{/each}
				</select>
				{#if connectionRef}<p class="help reference">{connectionRef}</p>{/if}
				<p class="help">Only this client’s server-configured connections appear here. Sandbox stores are for testing.</p>
			</div>
			<fieldset>
				<legend>Confirm with the client</legend>
				<label class="confirmation"><input type="checkbox" name="accountOwnershipConfirmed" required bind:checked={accountOwnershipConfirmed} /><span>The client owns this LumaPrints account and store.</span></label>
				<label class="confirmation"><input type="checkbox" name="billingConfirmed" required bind:checked={billingConfirmed} /><span>The client’s payment method and the store’s billing address are set up in LumaPrints.</span></label>
			</fieldset>
			<p class="help">Store verification checks API access. Account ownership and billing need these separate confirmations.</p>
			<button type="submit" class="primary" disabled={submitting}>{submitting ? "Verifying store…" : "Verify store and save connection"}</button>
		</form>
	{:else if data.status === "connected" && data.connection}
		<section aria-labelledby="supplier-status-heading">
			<h2 id="supplier-status-heading">Supplier connection saved</h2>
			{#if form?.saved}<p role="status">Store access was verified and the connection was saved.</p>{/if}
			<dl><div><dt>Store</dt><dd>{data.connection.storeId}</dd></div><div><dt>Environment</dt><dd>{data.connection.environment === "production" ? "Production" : "Sandbox"}</dd></div><div><dt>Connection reference</dt><dd class="reference">{data.connection.connectionRef}</dd></div></dl>
			<p>This connection stays with purchases that use it. Changing suppliers or reconnecting an account needs a separate review.</p>
		</section>
	{:else if data.status === "disabled"}
		<section aria-labelledby="supplier-status-heading"><h2 id="supplier-status-heading">Supplier setup is being prepared</h2><p>Client supplier setup is not open yet. Return here after the integration is released and its provider checks are complete.</p></section>
	{:else if data.status === "unconfigured"}
		<section aria-labelledby="supplier-status-heading"><h2 id="supplier-status-heading">Configure a client connection first</h2><p>Set up this client’s account, store, and server credentials before verifying the connection here. Keep credentials out of this form.</p></section>
	{:else if data.status === "historical"}
		<section aria-labelledby="supplier-status-heading"><h2 id="supplier-status-heading">This supplier connection needs review</h2><p>This client has a previous supplier connection. Review outstanding purchases before reconnecting or replacing it.</p></section>
	{:else if data.status === "unauthorized"}
		<section aria-labelledby="supplier-status-heading"><h2 id="supplier-status-heading">Operator access required</h2><p>Sign in with the Angels Rest operator account to manage client suppliers.</p></section>
	{:else}
		<section aria-labelledby="supplier-status-heading"><h2 id="supplier-status-heading">Supplier setup is unavailable</h2><p>Review the client’s connection configuration and try again.</p><a href={setupPath} data-sveltekit-reload>Try again</a></section>
	{/if}
	<footer>Before selling, confirm shipment notifications, supplier billing, payment readiness, and the shop’s tax setup. Shop activation is a separate step.</footer>
</div>

<style>
	.supplier-page { max-width: 840px; padding: 32px 40px 48px; color: var(--admin-text); font-size: 16px; line-height: 1.6; }
	.back-link { display: inline-block; margin-bottom: 28px; }
	a { color: var(--admin-text-muted); text-underline-offset: 4px; }
	header { display: flex; flex-direction: column; gap: 4px; margin-bottom: 28px; }
	.eyebrow { color: var(--admin-text-muted); font-size: .75rem; letter-spacing: .12em; text-transform: uppercase; }
	h1, h2, p { margin: 0; }
	h1 { font-size: 1.3rem; font-weight: 500; line-height: 1.3; }
	h2 { font-size: 1.15rem; font-weight: 500; }
	.client-name { font-weight: 500; }
	.website, .help { color: var(--admin-text-muted); font-size: .9rem; }
	.intro { margin-bottom: 28px; }
	form, section, .field { display: flex; flex-direction: column; gap: 16px; }
	form { gap: 24px; }
	.field { gap: 8px; }
	.field > label, legend { font-weight: 500; }
	select { width: 100%; min-width: 0; min-height: 48px; padding: 10px 12px; color: var(--admin-text); background: var(--admin-surface); border: 1px solid var(--admin-border); border-radius: 6px; font: inherit; }
	option { color: var(--admin-text); background: var(--admin-bg); }
	fieldset { display: flex; flex-direction: column; gap: 16px; padding: 0; border: 0; min-width: 0; }
	legend { margin-bottom: 16px; }
	.confirmation { display: flex; align-items: flex-start; gap: 12px; cursor: pointer; }
	.confirmation input { appearance: auto; flex: 0 0 20px; width: 20px; height: 20px; margin-top: 3px; accent-color: var(--admin-text); }
	.primary { align-self: flex-start; min-height: 48px; padding: 12px 20px; border: 0; border-radius: 6px; font: inherit; font-weight: 500; background: var(--admin-text); color: var(--admin-bg); cursor: pointer; }
	.primary:disabled { opacity: .6; cursor: wait; }
	:is(a, select, input, button):focus-visible { outline: 2px solid var(--admin-text); outline-offset: 4px; }
	.notice { margin-bottom: 24px; padding: 14px 16px; border-left: 3px solid var(--admin-text); background: var(--admin-surface); }
	dl { margin: 4px 0; display: flex; flex-direction: column; gap: 12px; }
	dl > div { display: grid; grid-template-columns: 180px minmax(0, 1fr); gap: 16px; }
	dt { color: var(--admin-text-muted); }
	dd { margin: 0; overflow-wrap: anywhere; }
	.reference { font-family: monospace; overflow-wrap: anywhere; }
	footer { margin-top: 32px; padding-top: 20px; border-top: 1px solid var(--admin-border); color: var(--admin-text-muted); font-size: .9rem; }
	@media (max-width: 640px) { .supplier-page { padding: 24px 20px 36px; } .primary { width: 100%; } dl > div { grid-template-columns: 1fr; gap: 2px; } }
</style>
