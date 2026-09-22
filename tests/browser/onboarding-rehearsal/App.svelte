<script lang="ts">
import { AdminLayout, setAdminConfig } from "@jessepomeroy/admin";
import HostPlatformPage from "../../../src/routes/admin/platform/+page.svelte";
import StripeSetupPage from "../../../src/lib/components/StripeSetupPage.svelte";
import LumaPrintsSetupPage from "../../../src/lib/components/LumaPrintsSetupPage.svelte";
import type { StripeConnectSetupData } from "../../../src/lib/stripeConnectSetup";
import type { LumaPrintsSetupData } from "../../../src/lib/lumaprintsSetup";
import { adminConfig } from "./config";
import { authClient, practicePassword } from "./auth";
import { currentClient, localNavigate, page, persist, reset } from "./state.svelte";
import { practice } from "./state.svelte";
import { siteSettings } from "../handbook/public-data";

setAdminConfig(adminConfig);
const route = page.url.pathname;
const client = $derived(currentClient());
const isPlatform = route === "/" || route === "/admin/platform";
const isStripe = route.startsWith("/portal/stripe/");
const isSupplier = route.startsWith("/admin/platform/lumaprints/");
const isProvider = route.startsWith("/__rehearsal/stripe/");
const isDashboard = route.startsWith("/__rehearsal/dashboard/");
const isLumaPrintsSignup = route.startsWith("/__rehearsal/lumaprints/");
const data = { siteSettings, stripeConnectOnboardingEnabled: true, stripeConnectOrigin: window.location.origin,
	adminSession: { status: "authorized" as const, email: "operator@angelsrest.example", tier: "full" as const, isCreator: true }, newInquiryCount: 0 };
const stripeData = $derived.by((): StripeConnectSetupData => ({
	siteUrl: client?.siteUrl ?? "unknown.example", onboardingEnabled: true, refundsEnabled: false,
	sessionStatus: practice.signedInEmail === client?.email ? "authorized" : "signed_out",
	email: practice.signedInEmail === client?.email ? client?.email ?? null : null,
	accountId: client?.stripeConnectedAccountId ?? null,
	readiness: client?.stripeStatus ? { status: client.stripeStatus, chargesEnabled: client.stripeStatus === "ready", payoutsEnabled: client.stripeStatus === "ready", detailsSubmitted: client.stripeStatus !== "setup_required" } : null,
	connectionIssue: null, message: null, returned: page.url.searchParams.get("returned") === "1",
}));
const supplierData = $derived.by((): LumaPrintsSetupData => ({
	siteUrl: client?.siteUrl ?? "unknown.example", clientName: client?.name ?? "",
	status: client?.supplierConnected ? "connected" : "available",
	choices: [{ connectionRef: "practice-client-store", storeId: 101, environment: "sandbox" }],
	connection: client?.supplierConnected ? { connectionRef: "practice-client-store", storeId: 101, environment: "sandbox" } : null,
}));
function providerReturn(completed: boolean) {
	if (!client) return;
	client.stripeStatus = completed ? "pending_verification" : "setup_required";
	persist();
	localNavigate(`/portal/stripe/${encodeURIComponent(client.siteUrl)}?returned=1`);
}
async function signOut() { await authClient.signOut(); }
</script>

<div class="rehearsal-bar" data-admin>
	<div><strong>Onboarding rehearsal</strong><span>{isPlatform || isSupplier ? "Operator view" : "Client view"} · actual Hub components; fictional authentication, records and provider responses.</span></div>
	<div class="toolbar"><a href="/admin/platform">Operator Platform</a><button onclick={reset}>Reset practice data</button></div>
</div>
{#if isPlatform}
	<div class="practice-instructions" data-admin><p><strong>Start here:</strong> choose <strong>Add platform client</strong>. Try <strong>Cedar Finch Studio</strong>, <code>cedarfinch.example</code>, <code>owner@cedarfinch.example</code>. Only fictional .example details are accepted. Records stay in this browser tab’s session.</p><p>Then select the client and open their setup page. The Hub’s real login and Stripe setup controls follow. No invite email is sent.</p></div>
	<AdminLayout {data}><HostPlatformPage {data} /></AdminLayout>
{:else if client && isStripe}
	<div class="practice-instructions" data-admin>
		{#if stripeData.sessionStatus === 'signed_out'}<p><strong>Practice login:</strong> email <code>{client.email}</code> · password <code>{practicePassword}</code>. Use these fictional credentials only. Google and real authentication are disabled.</p>
		{:else if client.stripeStatus === 'pending_verification'}<p><strong>Simulated timing:</strong> “Check status again” will advance this example to ready. Real Stripe verification may require more time or information.</p>
		{:else}<p>This is the actual client payment setup component. Its provider calls are replaced only in this separate rehearsal build.</p>{/if}
	</div>
	<StripeSetupPage data={stripeData} {authClient} onSignOut={signOut} />
{:else if client && isSupplier}
	<div class="practice-instructions" data-admin><p><strong>Operator step:</strong> this example supplies a fictional configured store. In real use, the client first creates their own LumaPrints account/store and billing, and you configure the connection. This page verifies access; it does not create the supplier account.</p></div>
	<AdminLayout {data}><LumaPrintsSetupPage data={supplierData} /></AdminLayout>
{:else if client && isLumaPrintsSignup}
	<main class="provider" data-admin>
		<h1>Simulated LumaPrints signup</h1>
		<p>On the live site, this link opens LumaPrints so you can create your account, add a Standard Store and enter billing details. This rehearsal creates no account and collects no billing information.</p>
		<a href={`/portal/stripe/${encodeURIComponent(client.siteUrl)}`}>Back to payment setup</a>
	</main>
{:else if client && (isProvider || isDashboard)}
	<main class="provider" data-admin>
		{#if isProvider}<h1>Simulated Stripe onboarding</h1><p>The same-tab redirect has reached the provider step. On the live site, this would be a secure Stripe-hosted page for <strong>{client.name}</strong>.</p><p>Stripe collects business, identity and bank details there. This test collects none of them.</p><div class="provider-actions"><button onclick={() => providerReturn(true)}>Complete simulated setup and return</button><button onclick={() => providerReturn(false)}>Return without finishing</button></div>
		{:else}<h1>Simulated Stripe dashboard destination</h1><p>The real link opens the client’s full Stripe Dashboard. This rehearsal keeps you here and sends no request to Stripe.</p><a href={`/portal/stripe/${encodeURIComponent(client.siteUrl)}`}>Back to payment setup</a>{/if}
	</main>
{:else}
	<main class="provider" data-admin><h1>This page is outside the rehearsal</h1><p>Start by adding a fictional platform client. This preview includes client creation, the Stripe setup journey and supplier setup.</p><a href="/admin/platform">Return to Platform</a></main>
{/if}

<style>
.rehearsal-bar { position: relative; z-index: 60; display: flex; justify-content: space-between; align-items: center; gap: 20px; padding: 14px 24px; background: var(--admin-surface); color: var(--admin-text); border-bottom: 1px solid var(--admin-border-strong); font-size: .85rem; }
.rehearsal-bar strong { display: block; margin-bottom: 4px; color: var(--admin-heading); }
.rehearsal-bar span { color: var(--admin-text-muted); }
.toolbar { display: flex; align-items: center; flex-wrap: wrap; gap: 16px; }
button { min-height: 44px; padding: 10px 16px; background: var(--admin-heading); color: var(--admin-bg); border: 1px solid var(--admin-border-strong); cursor: pointer; font: inherit; }
a { color: var(--admin-heading); text-underline-offset: 4px; }
.practice-instructions { position: relative; z-index: 55; background: var(--admin-bg); color: var(--admin-text-muted); padding: 16px 24px; border-bottom: 1px solid var(--admin-border); font-size: .9rem; line-height: 1.6; }
p { margin: 0 0 12px; } p:last-child { margin: 0; }
code { font-size: .85em; overflow-wrap: anywhere; }
.provider { max-width: 680px; padding: 50px 24px; margin: auto; color: var(--admin-text); line-height: 1.7; }
h1 { color: var(--admin-heading); font: 500 1.8rem/1.3 "Chillax", sans-serif; margin: 0 0 24px; }
.provider-actions { display: flex; gap: 16px; flex-wrap: wrap; margin-top: 28px; }
:is(button,a):focus-visible { outline: 2px solid var(--admin-heading); outline-offset: 4px; }
@media(max-width:768px){.rehearsal-bar { align-items: flex-start; flex-direction: column; padding: 14px 20px; gap: 12px; }.practice-instructions { padding: 16px 20px; }.provider-actions { flex-direction: column; }}
</style>
