<script lang="ts">
import { AdminModal } from "@jessepomeroy/admin";
import { normalizePlatformClientInput, PLATFORM_CLIENT_LOGIN_UNVERIFIED, PLATFORM_CLIENT_SITE_IN_USE } from "../../../packages/crm-api/convex/helpers/platformClientInput";

let { oncreated }: { oncreated: (client: { name: string; siteUrl: string }) => void } = $props();
let open = $state(false);
let saving = $state(false);
let name = $state("");
let website = $state("");
let email = $state("");
let tier = $state<"basic" | "full">("basic");
let message = $state("");
let added = $state("");
let handoff = $state<{ email: string; temporaryPassword: string | null } | null>(null);
let copied = $state(false);
let revealed = $state(false);

function begin() {
	name = "";
	website = "";
	email = "";
	tier = "basic";
	message = "";
	handoff = null;
	copied = false;
	revealed = false;
	open = true;
}

function close() {
	if (saving) return;
	open = false;
	handoff = null;
	revealed = false;
}

async function copyLogin() {
	if (!handoff?.temporaryPassword) return;
	try {
		await navigator.clipboard.writeText(`Email: ${handoff.email}\nTemporary password: ${handoff.temporaryPassword}\nAfter signing in, choose Change password in the admin sidebar.`);
		copied = true;
		message = "";
	} catch {
		message = "Copy was unavailable. Reveal the password and copy it manually before closing.";
	}
}

async function save(event: SubmitEvent) {
	event.preventDefault();
	if (saving) return;
	message = "";
	let identity: ReturnType<typeof normalizePlatformClientInput>;
	try {
		identity = normalizePlatformClientInput({ name, email, siteUrl: website, adminEmails: [email] });
	} catch (error) {
		message = error instanceof Error ? error.message : "Check the client details.";
		return;
	}
	saving = true;
	try {
		const response = await fetch("/api/admin/platform-clients", {
			method: "POST",
			headers: { "content-type": "application/json" },
			cache: "no-store",
			body: JSON.stringify({ name: identity.name, email: identity.email, siteUrl: identity.siteUrl, tier }),
		});
		const result: unknown = await response.json();
		if (!response.ok) {
			throw new Error(result && typeof result === "object" && "error" in result && typeof result.error === "string" ? result.error : "Client creation failed");
		}
		if (!result || typeof result !== "object" || !("email" in result) || typeof result.email !== "string"
			|| !("temporaryPassword" in result) || (result.temporaryPassword !== null && typeof result.temporaryPassword !== "string")) {
			throw new Error("Client creation could not be confirmed");
		}
		handoff = { email: result.email, temporaryPassword: result.temporaryPassword };
		added = `${identity.name} was added. Share their setup link when payment onboarding is enabled.`;
		oncreated({ name: identity.name, siteUrl: identity.siteUrl });
	} catch (error) {
		const reason = error instanceof Error ? error.message : "";
		message = reason.includes(PLATFORM_CLIENT_SITE_IN_USE)
			? "That website already belongs to a platform client. Select the existing client below."
			: reason.includes(PLATFORM_CLIENT_LOGIN_UNVERIFIED)
				? "This email has an unverified login without existing site access. Verify the login before adding this client."
			: "We could not confirm the client was added. Check the platform list before trying again.";
	} finally {
		saving = false;
	}
}
</script>

<section class="client-entry" aria-label="Add a platform client">
	<div><h2>Start a client setup</h2><p>Create the business record and allow its administrator to sign in.</p></div>
	<button type="button" class="primary" onclick={begin}>Add platform client</button>
</section>
{#if added}<p class="created" role="status">{added}</p>{/if}

{#if open}
	<div class="client-modal" class:saving>
	<AdminModal title={handoff ? "Client added" : "Add platform client"} onclose={close}>
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
		{:else}
		<form onsubmit={save} aria-busy={saving}>
			<p class="intro">Add the business that will use your platform. This is separate from a photography customer in the CRM.</p>
			{#if message}<p class="error" role="alert">{message}</p>{/if}
			<div class="field"><label for="platform-name">Business name</label><input id="platform-name" bind:value={name} maxlength="120" required disabled={saving} autocomplete="organization" /></div>
			<div class="field"><label for="platform-website">Website hostname</label><input id="platform-website" bind:value={website} maxlength="300" required disabled={saving} placeholder="studio.example" autocapitalize="none" spellcheck="false" aria-describedby="website-help" /><p id="website-help" class="help">Use the client's website domain. You can paste its homepage URL.</p></div>
			<div class="field"><label for="platform-email">Client admin email</label><input id="platform-email" type="email" bind:value={email} maxlength="254" required disabled={saving} autocomplete="email" aria-describedby="email-help" /><p id="email-help" class="help">A new login gets a temporary password for you to share. Existing logins stay unchanged. No invitation email is sent.</p></div>
			<div class="field"><label for="platform-tier">Access tier</label><select id="platform-tier" bind:value={tier} disabled={saving}><option value="basic">Basic</option><option value="full">Full</option></select></div>
			<p class="help">Adding a client does not start a paid subscription, create their provider accounts or open their shop. Billing and commercial activation stay separate.</p>
			<div class="actions"><button type="button" class="secondary" onclick={close} disabled={saving}>Cancel</button><button type="submit" class="primary" disabled={saving || !name.trim() || !website.trim() || !email.trim()}>{saving ? "Adding client…" : "Add client"}</button></div>
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
form, .handoff { padding: 0 28px 28px; display: flex; flex-direction: column; gap: 20px; }
.intro { font-size: .9rem; }
.field { display: flex; flex-direction: column; gap: 8px; }
label { color: var(--admin-text); font-size: .9rem; }
input, select { width: 100%; min-width: 0; min-height: 48px; box-sizing: border-box; padding: 10px 12px; background: var(--admin-control-well); color: var(--admin-heading); border: 1px solid var(--admin-control-edge); border-radius: 0; font: inherit; }
.help { font-size: .82rem; }
.error { padding: 12px; border: 1px solid var(--status-rose); color: var(--admin-text); }
.actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 12px; }
button { min-height: 44px; padding: 10px 16px; font: inherit; cursor: pointer; border: 1px solid var(--admin-border-strong); border-radius: 4px; }
.primary { background: var(--admin-heading); color: var(--admin-bg); }
.secondary { background: transparent; color: var(--admin-text); }
button:disabled { opacity: .55; cursor: not-allowed; }
:is(button, input, select):focus-visible { outline: 2px solid var(--admin-heading); outline-offset: 3px; }
@media (max-width: 640px) { .client-entry { align-items: stretch; flex-direction: column; margin: 24px 20px 0; gap: 16px; } .created { margin-inline: 20px; } form, .handoff { padding: 0 20px 20px; } }
</style>
