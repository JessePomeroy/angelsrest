<script lang="ts">
import { LoginPage, setAdminConfig, type AdminAuthClient } from "@jessepomeroy/admin";
import { clientPrintRefundPath } from "$lib/clientPrintRefunds";
import { adminConfig } from "$lib/config/admin";
import { stripeConnectSetupPath, type StripeConnectSetupData } from "$lib/stripeConnectSetup";

let { data, form, authClient, onSignOut }: {
	data: StripeConnectSetupData;
	form?: { message: string } | null;
	authClient: AdminAuthClient;
	onSignOut: () => Promise<void>;
} = $props();
let starting = $state(false);
let signingOut = $state(false);
let signOutError = $state("");
const setupPath = $derived(stripeConnectSetupPath(data.siteUrl));
const ready = $derived(data.readiness?.status === "ready");
const titles = {
	setup_required: "Finish your Stripe setup",
	pending_verification: "Stripe is reviewing your information",
	restricted: "Your Stripe account needs attention",
	ready: "Your Stripe account is ready",
};
const descriptions = {
	setup_required: "Continue with Stripe to finish your business and bank details.",
	pending_verification: "Stripe has not enabled both payments and payouts yet. Check your Stripe dashboard for any next steps.",
	restricted: "Open Stripe to review the requirements or restrictions on your account.",
	ready: "Stripe has enabled payments and payouts. Angels Rest will confirm when your store is ready to sell.",
};
setAdminConfig({
	...adminConfig, isCreator: false,
	get authClient() { return authClient; },
	get siteUrl() { return data.siteUrl; },
	get authCallbackURL() { return stripeConnectSetupPath(data.siteUrl); },
});

async function signOut() {
	if (signingOut) return;
	signingOut = true;
	signOutError = "";
	try { await onSignOut(); }
	catch { signOutError = "We could not sign you out. Please try again."; signingOut = false; }
}
</script>

<svelte:head>
	<title>Stripe setup · Angels Rest</title>
	<meta name="robots" content="noindex,nofollow" />
</svelte:head>

<main class="payment-page" data-admin>
	<div class="payment-content">
		<header>
			<a class="brand" href="/">angel’s rest</a>
			<p class="eyebrow">client payments</p>
			<h1>Set up your Stripe account</h1>
			<p class="site-name">{data.siteUrl}</p>
		</header>

		{#if form?.message}<p class="notice error" role="alert">{form.message}</p>{/if}
		{#if data.sessionStatus === "signed_out"}
			<p>Sign in with the login you use to manage this website. Your Stripe business and bank details stay with Stripe.</p>
			<div class="sign-in">
				{#key data.siteUrl}<LoginPage />{/key}
			</div>
		{:else if data.sessionStatus === "unauthorized" || data.sessionStatus === "unavailable"}
			<section class="connection-status" aria-labelledby="connection-heading">
				<h2 id="connection-heading">{data.sessionStatus === "unauthorized" ? "Use your website’s admin login" : "We couldn’t verify the connection"}</h2>
				<p role="alert">{data.message}</p>
				{#if data.sessionStatus === "unauthorized"}<p>Sign in with an account invited to manage {data.siteUrl}.</p>{/if}
				<a class="button secondary" href={setupPath} data-sveltekit-reload>Try again</a>
			</section>
		{:else if !data.onboardingEnabled}
			<section class="connection-status" aria-labelledby="connection-heading">
				<h2 id="connection-heading">Payment setup is being prepared</h2>
				<p>Angels Rest will let you know when you can continue. You can return to this page then.</p>
			</section>
		{:else if data.connectionIssue}
			<section class="connection-status" aria-labelledby="connection-heading">
				<h2 id="connection-heading">{data.connectionIssue === "disconnected" ? "Your Stripe connection has been disconnected" : data.connectionIssue === "checking" ? "A status check is in progress" : "We couldn’t verify your Stripe status"}</h2>
				<p>{data.connectionIssue === "disconnected" ? "You can still sign in to your own Stripe dashboard. Contact Angels Rest to review the connection before reconnecting your website." : data.connectionIssue === "checking" ? "A newer check is underway. Check again in a moment for the latest payment and payout status." : "Payment and payout status is temporarily unavailable. Check again or contact Angels Rest for help."}</p>
				<div class="actions">
					<a class="button" href={setupPath} data-sveltekit-reload>Check status again</a>
					{#if data.accountId}<a class="button secondary" href="https://dashboard.stripe.com/" rel="noreferrer">Open Stripe dashboard</a>{/if}
				</div>
			</section>
		{:else}
			<section class="connection-status" aria-labelledby="connection-heading">
				<p class="eyebrow">{data.readiness ? "checked with Stripe" : "before you begin"}</p>
				<h2 id="connection-heading">{data.readiness ? titles[data.readiness.status] : "Connect payments to your business"}</h2>
				<p>{data.readiness ? descriptions[data.readiness.status] : "You’ll have your own full Stripe dashboard. You’ll complete your business and bank details securely with Stripe, then return here."}</p>
				{#if data.returned && !ready}<p class="notice">Returning from Stripe does not mean setup is complete. Your current status is shown here.</p>{/if}
				{#if data.readiness}
					<dl class="capabilities">
						<div><dt>Accept payments</dt><dd>{data.readiness.chargesEnabled ? "Enabled" : "Not enabled"}</dd></div>
						<div><dt>Receive payouts</dt><dd>{data.readiness.payoutsEnabled ? "Enabled" : "Not enabled"}</dd></div>
					</dl>
				{/if}
				<div class="actions">
					{#if !ready}
						<form method="POST" action={`${setupPath}?/start`} onsubmit={() => { starting = true; }}>
							<button class="button" type="submit" disabled={starting}>{starting ? "Opening Stripe…" : data.accountId ? "Continue with Stripe" : "Start Stripe setup"}</button>
						</form>
					{/if}
					{#if data.accountId}<a class:secondary={!ready} class="button" href="https://dashboard.stripe.com/" rel="noreferrer">Open Stripe dashboard</a>{/if}
					<a class="status-refresh" href={setupPath} data-sveltekit-reload>Check status again</a>
				</div>
			</section>
			{#if ready}
				<section class="fulfillment-next-step" aria-labelledby="fulfillment-heading">
					<h2 id="fulfillment-heading">Next: set up LumaPrints</h2>
					<p>Create an account (or use your existing one), add a Standard Store and enter your billing details. Let Angels Rest know when you’re ready—we’ll connect your store.</p>
					<a class="button" href="https://dashboard.lumaprints.com/account/register/" rel="noreferrer">Set up LumaPrints</a>
				</section>
			{/if}
		{/if}

		{#if data.sessionStatus === "authorized" && data.refundsEnabled}<p><a class="button secondary" href={clientPrintRefundPath(data.siteUrl)}>Print refunds</a></p>{/if}
		{#if data.email}
			<div class="session">
				<span>Signed in as {data.email}</span>
				<button type="button" class="text-button" onclick={signOut} disabled={signingOut}>{signingOut ? "Signing out…" : "Sign out"}</button>
			</div>
		{/if}
		{#if signOutError}<p class="notice error" role="alert">{signOutError}</p>{/if}
		<footer><a href="/about">Contact Angels Rest</a><span>Store activation is a separate step.</span></footer>
	</div>
</main>

<style>
.payment-page { min-height: 100dvh; background: var(--admin-bg); color: var(--admin-text); padding: clamp(24px, 6vw, 80px) 24px; }
.payment-content { max-width: 600px; margin-inline: auto; }
header { margin-bottom: 32px; }
.brand { font-family: "Chillax", sans-serif; color: var(--admin-heading); text-decoration: none; font-size: 1.2rem; }
.eyebrow { margin: 32px 0 10px; color: var(--admin-text-subtle); font-size: .75rem; letter-spacing: .08em; text-transform: uppercase; }
h1, h2 { font-family: "Chillax", sans-serif; color: var(--admin-heading); font-weight: 500; text-wrap: balance; }
h1 { font-size: clamp(1.8rem, 5vw, 2.5rem); line-height: 1.15; margin: 0 0 12px; }
h2 { font-size: 1.35rem; margin: 0 0 12px; }
p { line-height: 1.65; color: var(--admin-text-muted); }
.site-name { margin: 0; overflow-wrap: anywhere; }
.connection-status { border-block: 1px solid var(--admin-border); padding-block: 28px; }
.connection-status .eyebrow { margin-top: 0; }
.connection-status p { margin: 0 0 20px; }
.fulfillment-next-step { padding-block: 28px; border-bottom: 1px solid var(--admin-border); }
.fulfillment-next-step p { margin: 0 0 20px; }
.capabilities { margin: 24px 0; display: grid; gap: 12px; }
.capabilities div { display: flex; justify-content: space-between; gap: 20px; }
dt { color: var(--admin-text-muted); }
dd { margin: 0; font-weight: 500; text-align: right; }
.actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.actions form { margin: 0; }
.button { min-height: 44px; display: inline-flex; align-items: center; justify-content: center; padding: 10px 16px; border: 1px solid var(--admin-heading); border-radius: 4px; background: var(--admin-heading); color: var(--admin-bg); text-decoration: none; font: inherit; cursor: pointer; }
.button.secondary { background: transparent; color: var(--admin-heading); border-color: var(--admin-border-strong); }
button:disabled { cursor: wait; opacity: .6; }
a:focus-visible, button:focus-visible { outline: 2px solid var(--admin-heading); outline-offset: 4px; }
.status-refresh, .text-button, footer a { color: var(--admin-text-muted); text-underline-offset: 4px; }
.status-refresh { padding: 10px 0; }
.notice { padding: 12px 16px; background: var(--admin-surface); border-left: 2px solid var(--admin-border-strong); }
.notice.error { border-color: var(--status-rose); }
.session { display: flex; align-items: baseline; justify-content: space-between; gap: 16px; margin-top: 24px; font-size: .85rem; }
.session span { overflow-wrap: anywhere; min-width: 0; }
.text-button { background: none; border: 0; min-height: 44px; padding: 10px 0; text-decoration: underline; font: inherit; white-space: nowrap; cursor: pointer; }
footer { display: flex; flex-wrap: wrap; gap: 12px 24px; margin-top: 32px; color: var(--admin-text-subtle); font-size: .8rem; }
.sign-in :global(.login-page) { min-height: auto; padding: 20px 0; background: transparent; justify-content: flex-start; }
.sign-in :global(.login-brand) { display: none; }
@media (max-width: 480px) { .actions { align-items: stretch; flex-direction: column; } .actions form, .button { width: 100%; } .session { align-items: flex-start; } }
</style>
