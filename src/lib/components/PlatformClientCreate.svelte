<script lang="ts">
import AdminModal from "@jessepomeroy/admin/components/AdminModal";
import { onDestroy } from "svelte";
import { CLIENT_SETUP_CONFLICT_LABELS, MAX_CLIENT_SETUP_PLAN_BYTES, parseClientSetupPlan, parseClientSetupStatus, type ClientSetupPlan, type ClientSetupStatus, type PlatformClientIntent } from "$lib/platformClientSetup";
import { normalizePlatformClientInput, PLATFORM_CLIENT_LOGIN_UNVERIFIED } from "../../../packages/crm-api/convex/helpers/platformClientInput";

let { oncreated }: { oncreated: (client: { name: string; siteUrl: string }) => void } = $props();
let open = $state(false);
let activity = $state<"checking" | "creating" | "loading-plan" | null>(null);
let saving = $derived(activity === "creating");
let name = $state("");
let website = $state("");
let email = $state("");
let tier = $state<"basic" | "full">("basic");
let setupPlan = $state.raw<ClientSetupPlan | null>(null);
let planError = $state("");
let message = $state("");
let added = $state("");
let review = $state.raw<{ input: PlatformClientIntent; plan: ClientSetupPlan | null; status: ClientSetupStatus | null; attempted: boolean } | null>(null);
let handoff = $state<{ email: string; temporaryPassword: string | null } | null>(null);
let copied = $state(false);
let revealed = $state(false);
let version = 0;
let activeRequest: AbortController | null = null;

function invalidate() {
	version += 1;
	activeRequest?.abort();
	activeRequest = null;
	activity = null;
}
function edit() {
	invalidate();
	review = null;
	message = "";
}
function begin() {
	edit();
	name = "";
	website = "";
	email = "";
	tier = "basic";
	setupPlan = null;
	planError = "";
	handoff = null;
	copied = false;
	revealed = false;
	open = true;
}
function close() {
	if (saving) return;
	invalidate();
	open = false;
	review = null;
	setupPlan = null;
	planError = "";
	handoff = null;
	revealed = false;
}
onDestroy(() => { invalidate(); handoff = null; });

async function loadPlan(event: Event) {
	if (!(event.currentTarget instanceof HTMLInputElement)) return;
	const file = event.currentTarget.files?.[0];
	event.currentTarget.value = "";
	if (!file) return;
	edit();
	setupPlan = null;
	planError = "";
	activity = "loading-plan";
	const current = version;
	try {
		if (file.size > MAX_CLIENT_SETUP_PLAN_BYTES) throw new Error();
		const result = parseClientSetupPlan(JSON.parse(await file.text()));
		if (!result) throw new Error();
		if (current !== version || !open) return;
		setupPlan = result;
		website = result.identity.siteUrl;
	} catch {
		if (current === version && open) planError = "This file is not a prepared client setup plan. Prepare a current plan and try again.";
	} finally { if (current === version) activity = null; }
}
function bodyFor(snapshot: NonNullable<typeof review>) {
	return JSON.stringify({ ...snapshot.input, ...(snapshot.plan ? { setupPlan: snapshot.plan } : {}) });
}
function start(next: "checking" | "creating") {
	invalidate();
	activity = next;
	message = "";
	const controller = new AbortController();
	activeRequest = controller;
	return { current: version, signal: controller.signal };
}
async function requestSetup(path: string, snapshot: NonNullable<typeof review>, signal: AbortSignal) {
	const deadline = new AbortController();
	// Keep fetch attached to this controller: WebKit can collect an inline AbortSignal.any signal.
	const abort = () => deadline.abort(signal.reason);
	signal.addEventListener("abort", abort, { once: true });
	if (signal.aborted) abort();
	const timer = setTimeout(() => deadline.abort(), 20_000);
	try {
		const response = await fetch(path, {
			method: "POST", headers: { "content-type": "application/json" }, cache: "no-store", body: bodyFor(snapshot),
			signal: deadline.signal,
		});
		const body: unknown = await response.json();
		return { ok: response.ok, status: response.status, body };
	} finally {
		clearTimeout(timer);
		signal.removeEventListener("abort", abort);
	}
}
async function readStatus(snapshot: NonNullable<typeof review>, signal: AbortSignal) {
	const response = await requestSetup("/api/admin/platform-clients/status", snapshot, signal);
	if (!response.ok) throw new Error();
	const result = parseClientSetupStatus(response.body, snapshot.input.siteUrl);
	if (!result) throw new Error();
	return result;
}
async function checkStatus() {
	if (!review || saving) return;
	const snapshot = review;
	const { current, signal } = start("checking");
	try {
		const status = await readStatus(snapshot, signal);
		if (current === version && open) review = { ...snapshot, status };
	} catch {
		if (current === version && open) {
			review = { ...snapshot, status: null };
			message = "We could not check this setup. Check status again before creating a client.";
		}
	} finally { if (current === version) activity = null; }
}
async function reviewDetails(event: SubmitEvent) {
	event.preventDefault();
	if (activity || planError) return;
	message = "";
	try {
		const input = normalizePlatformClientInput({ name, email, siteUrl: website, adminEmails: [email] });
		review = { input: { name: input.name, email: input.email, siteUrl: input.siteUrl, tier }, plan: setupPlan, status: null, attempted: false };
	} catch (cause) {
		message = cause instanceof Error ? cause.message : "Check the client details.";
		return;
	}
	await checkStatus();
}
async function createClient() {
	if (activity || !review || review.status?.kind !== "absent") return;
	const snapshot = { ...review, attempted: true };
	const { current, signal } = start("creating");
	review = snapshot;
	try {
		const response = await requestSetup("/api/admin/platform-clients", snapshot, signal);
		const result = response.body;
		if (current !== version || !open) return;
		if (response.status === 409 && result && typeof result === "object" && "error" in result && result.error === PLATFORM_CLIENT_LOGIN_UNVERIFIED) {
			review = null;
			message = "This email has an unverified login without existing site access. Verify the login before adding this client.";
			return;
		}
		if (!response.ok || !result || typeof result !== "object" || !("kind" in result)) throw new Error();
		if (result.kind === "observed" && "status" in result) {
			const status = parseClientSetupStatus(result.status, snapshot.input.siteUrl);
			if (!status) throw new Error();
			review = { ...snapshot, status };
			return;
		}
		if (result.kind !== "created" || !("email" in result) || result.email !== snapshot.input.email
			|| !("temporaryPassword" in result) || !(result.temporaryPassword === null || (typeof result.temporaryPassword === "string" && result.temporaryPassword.length > 0))) throw new Error();
		handoff = { email: result.email, temporaryPassword: result.temporaryPassword };
		added = `${snapshot.input.name} was added. Provider setup and activation remain separate.`;
		oncreated({ name: snapshot.input.name, siteUrl: snapshot.input.siteUrl });
	} catch {
		if (current !== version || !open) return;
		try {
			// A lost response cannot safely replay the write or recover its one-time password.
			const status = await readStatus(snapshot, signal);
			if (current === version && open) review = { ...snapshot, status };
		} catch {
			if (current === version && open) {
				review = { ...snapshot, status: null };
				message = "Client creation is unconfirmed. Check status before trying again.";
			}
		}
	} finally { if (current === version) activity = null; }
}
async function copyLogin() {
	if (!handoff?.temporaryPassword) return;
	const current = version;
	try {
		await navigator.clipboard.writeText(`Email: ${handoff.email}\nTemporary password: ${handoff.temporaryPassword}\nAfter signing in, choose Change password in the admin sidebar.`);
		if (current === version && open) { copied = true; message = ""; }
	} catch {
		if (current === version && open) message = "Copy was unavailable. Reveal the password and copy it manually before closing.";
	}
}
function selectExisting() {
	if (review?.status?.kind !== "matching") return;
	oncreated({ name: review.input.name, siteUrl: review.input.siteUrl });
	close();
}
</script>

<section class="client-entry" aria-label="Add a platform client">
	<div><h2>Start a client setup</h2><p>Create the business record and allow its administrator to sign in.</p></div>
	<button type="button" class="primary" onclick={begin}>Add platform client</button>
</section>
{#if added}<p class="created" role="status">{added}</p>{/if}

{#if open}
	<div class="client-modal" class:saving>
	<AdminModal title={handoff ? "Client added" : review ? "Review client setup" : "Add platform client"} onclose={close}>
		{#if handoff}
		<div class="handoff">
			{#if message}<p class="error" role="alert">{message}</p>{/if}
			<p>{handoff.email}</p>
			{#if handoff.temporaryPassword}
				<div class="field"><label for="client-temporary-password">Temporary password</label><input id="client-temporary-password" type={revealed ? "text" : "password"} value={handoff.temporaryPassword} readonly autocomplete="off" spellcheck="false" /></div>
				<p class="help">Save these login details before closing. This password is shown only here. Ask the client to choose <strong>Change password</strong> in their admin sidebar after signing in.</p>
				<div class="actions"><button type="button" class="secondary" onclick={() => { revealed = !revealed; }}>{revealed ? "Hide password" : "Reveal password"}</button><button type="button" class="primary" onclick={copyLogin}>{copied ? "Copied" : "Copy login details"}</button></div>
			{:else}
				<p>This email already has a login. Their existing password or Google sign-in stays the same.</p>
			{/if}
			<div class="actions"><button type="button" class="secondary" onclick={close}>Done</button></div>
		</div>
		{:else if review}
		<div class="review" aria-busy={activity !== null}>
			{#if message}<p class="error" role="alert">{message}</p>{/if}
			<dl><div><dt>Business</dt><dd>{review.input.name}</dd></div><div><dt>Website</dt><dd>{review.input.siteUrl}</dd></div><div><dt>Administrator</dt><dd>{review.input.email}</dd></div><div><dt>Access</dt><dd>{review.input.tier === "basic" ? "Basic" : "Full"}</dd></div>
			{#if review.plan}<div><dt>Environment</dt><dd>{review.plan.identity.environmentId}</dd></div><div><dt>Public site</dt><dd>{review.plan.target.publicOrigin}</dd></div>{/if}</dl>
			{#if activity === "checking"}<p role="status">Checking the existing setup…</p>
			{:else if review.status?.kind === "matching"}
				<p role="status">This client matches the reviewed setup. Continue with the existing record.</p>
				<p class="notice"><strong>Password handoff is unconfirmed.</strong> A password from an earlier request cannot be shown again. Verify sign-in before handing this account over.</p>
			{:else if review.status?.kind === "conflict"}
				<p class="notice" role="alert">An existing setup needs review. Further creation is stopped.</p>
				<p>Resolve these differences before continuing: {review.status.conflicts.map(key => CLIENT_SETUP_CONFLICT_LABELS[key]).join(", ")}.</p>
			{:else if review.status?.kind === "absent"}
				{#if review.attempted}<p class="notice" role="status">Creation was not confirmed. No matching client is visible yet. You can explicitly retry; the website will be checked again first.</p>
				{:else}<p>A new client will be created with these details. Existing logins keep their current credentials.</p>{/if}
			{/if}
			<p class="help">This step does not configure providers, start billing or open the shop.</p>
			<div class="actions"><button type="button" class="secondary" onclick={edit} disabled={saving}>Edit details</button>
				{#if review.status?.kind === "absent"}<button type="button" class="primary" onclick={createClient} disabled={activity !== null}>{saving ? "Adding client…" : review.attempted ? "Retry creation" : "Create client"}</button>
				{:else if review.status?.kind === "matching"}<button type="button" class="primary" onclick={selectExisting}>Select existing client</button>
				{:else if !review.status}<button type="button" class="primary" onclick={checkStatus} disabled={activity !== null}>Check status</button>{/if}
			</div>
		</div>
		{:else}
		<form onsubmit={reviewDetails}>
			<p class="intro">Add the business that will use your platform. This is separate from a photography customer in the CRM.</p>
			{#if message}<p class="error" role="alert">{message}</p>{/if}
			<div class="field"><label for="platform-setup-plan">Setup plan (optional)</label><input id="platform-setup-plan" type="file" accept="application/json,.json" onchange={loadPlan} />
				{#if planError}<p class="error" role="alert">{planError}</p>{/if}
				{#if activity === "loading-plan"}<p class="help" role="status">Loading setup plan…</p>{/if}
				{#if setupPlan}<p class="help">Loaded for {setupPlan.identity.environmentId}: {setupPlan.target.publicOrigin}</p>{:else}<p class="help">Load a prepared plan to bind this request to its website and backend.</p>{/if}
				{#if setupPlan || planError}<button type="button" class="secondary" onclick={() => { edit(); setupPlan = null; planError = ""; }}>Remove plan</button>{/if}
			</div>
			<div class="field"><label for="platform-name">Business name</label><input id="platform-name" bind:value={name} oninput={edit} maxlength="120" required autocomplete="organization" /></div>
			<div class="field"><label for="platform-website">Website hostname</label><input id="platform-website" bind:value={website} oninput={edit} maxlength="300" required disabled={setupPlan !== null} placeholder="studio.example" autocapitalize="none" spellcheck="false" aria-describedby="website-help" /><p id="website-help" class="help">Use the client's website domain. You can paste its homepage URL.</p></div>
			<div class="field"><label for="platform-email">Client admin email</label><input id="platform-email" type="email" bind:value={email} oninput={edit} maxlength="254" required autocomplete="email" aria-describedby="email-help" /><p id="email-help" class="help">A new login gets a temporary password for you to share. Existing logins stay unchanged. No invitation email is sent.</p></div>
			<div class="field"><label for="platform-tier">Access tier</label><select id="platform-tier" bind:value={tier} onchange={edit}><option value="basic">Basic</option><option value="full">Full</option></select></div>
			<div class="actions"><button type="button" class="secondary" onclick={close}>Cancel</button><button type="submit" class="primary" disabled={activity !== null || !!planError || !name.trim() || !website.trim() || !email.trim()}>Review setup</button></div>
		</form>
		{/if}
	</AdminModal>
	</div>
{/if}

<style>
.client-entry { display: flex; justify-content: space-between; align-items: center; gap: 24px; margin: 32px 40px 0; max-width: 1200px; color: var(--admin-text); }
h2 { color: var(--admin-heading); font: 500 1.2rem/1.35 "Chillax", sans-serif; margin: 0 0 8px; }
p { margin: 0; line-height: 1.6; color: var(--admin-text-muted); }
.client-entry p { font-size: .9rem; }
.created { margin: 20px 40px 0; color: var(--status-sage); }
/* The shared sheet assumes a drag dismisses it; keep it still while close is blocked. */
.client-modal.saving :global(.sheet-handle) { pointer-events: none; }
form, .handoff, .review { padding: 0 28px 28px; display: flex; flex-direction: column; gap: 20px; }
.intro { font-size: .9rem; }
.field { display: flex; flex-direction: column; gap: 8px; }
label { color: var(--admin-text); font-size: .9rem; }
input, select { width: 100%; min-width: 0; min-height: 48px; box-sizing: border-box; padding: 10px 12px; background: var(--admin-control-well); color: var(--admin-heading); border: 1px solid var(--admin-control-edge); border-radius: 0; font: inherit; }
.help { font-size: .82rem; }
.notice { padding: 12px; border: 1px solid var(--admin-border-strong); }
dl { margin: 0; display: grid; gap: 12px; }
dl div { display: grid; grid-template-columns: 110px minmax(0, 1fr); gap: 12px; }
dt { color: var(--admin-text-muted); }
dd { margin: 0; color: var(--admin-heading); overflow-wrap: anywhere; }
.error { padding: 12px; border: 1px solid var(--status-rose); color: var(--admin-text); }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; }
button { min-height: 44px; padding: 10px 16px; font: inherit; cursor: pointer; border: 1px solid var(--admin-border-strong); border-radius: 4px; }
.primary { background: var(--admin-heading); color: var(--admin-bg); }
.secondary { background: transparent; color: var(--admin-text); }
button:disabled { opacity: .55; cursor: not-allowed; }
:is(button, input, select):focus-visible { outline: 2px solid var(--admin-heading); outline-offset: 3px; }
@media (max-width: 640px) { .client-entry { align-items: stretch; flex-direction: column; margin: 24px 20px 0; gap: 16px; } .created { margin-inline: 20px; } form, .handoff, .review { padding: 0 20px 20px; } }
</style>
