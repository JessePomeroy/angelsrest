<script lang="ts">
import { AdminModal, getAdminConfig, useAdminClient } from "@jessepomeroy/admin";
import { normalizePlatformClientInput, PLATFORM_CLIENT_SITE_IN_USE } from "../../../packages/crm-api/convex/helpers/platformClientInput";

let { oncreated }: { oncreated: (client: { name: string; siteUrl: string }) => void } = $props();
const config = getAdminConfig();
const client = useAdminClient();
let open = $state(false);
let saving = $state(false);
let name = $state("");
let website = $state("");
let email = $state("");
let tier = $state<"basic" | "full">("basic");
let message = $state("");
let added = $state("");

function begin() {
	name = "";
	website = "";
	email = "";
	tier = "basic";
	message = "";
	open = true;
}

function close() { if (!saving) open = false; }

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
		await client.mutation(config.api.platform.createClient, {
			...identity,
			tier,
			subscriptionStatus: "none",
			role: "client",
		});
		open = false;
		added = `${identity.name} was added. Share their setup link when payment onboarding is enabled.`;
		oncreated({ name: identity.name, siteUrl: identity.siteUrl });
	} catch (error) {
		message = error instanceof Error && error.message.includes(PLATFORM_CLIENT_SITE_IN_USE)
			? "That website already belongs to a platform client. Select the existing client below."
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
	<AdminModal title="Add platform client" onclose={close}>
		<form onsubmit={save} aria-busy={saving}>
			<p class="intro">Add the business that will use your platform. This is separate from a photography customer in the CRM.</p>
			{#if message}<p class="error" role="alert">{message}</p>{/if}
			<div class="field"><label for="platform-name">Business name</label><input id="platform-name" bind:value={name} maxlength="120" required disabled={saving} autocomplete="organization" /></div>
			<div class="field"><label for="platform-website">Website hostname</label><input id="platform-website" bind:value={website} maxlength="300" required disabled={saving} placeholder="studio.example" autocapitalize="none" spellcheck="false" aria-describedby="website-help" /><p id="website-help" class="help">Use the client's website domain. You can paste its homepage URL.</p></div>
			<div class="field"><label for="platform-email">Client admin email</label><input id="platform-email" type="email" bind:value={email} maxlength="254" required disabled={saving} autocomplete="email" aria-describedby="email-help" /><p id="email-help" class="help">This email is allowed to manage this client's site. Use the email for their website-admin sign-in. This grants access; it does not create a password or send an invitation email.</p></div>
			<div class="field"><label for="platform-tier">Access tier</label><select id="platform-tier" bind:value={tier} disabled={saving}><option value="basic">Basic</option><option value="full">Full</option></select></div>
			<p class="help">Adding a client does not start a paid subscription, create their provider accounts or open their shop. Billing and commercial activation stay separate.</p>
			<div class="actions"><button type="button" class="secondary" onclick={close} disabled={saving}>Cancel</button><button type="submit" class="primary" disabled={saving || !name.trim() || !website.trim() || !email.trim()}>{saving ? "Adding client…" : "Add client"}</button></div>
		</form>
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
form { padding: 0 28px 28px; display: flex; flex-direction: column; gap: 20px; }
.intro { font-size: .9rem; }
.field { display: flex; flex-direction: column; gap: 8px; }
label { color: var(--admin-text); font-size: .9rem; }
input, select { width: 100%; min-width: 0; min-height: 48px; box-sizing: border-box; padding: 10px 12px; background: var(--admin-control-well); color: var(--admin-heading); border: 1px solid var(--admin-control-edge); border-radius: 0; font: inherit; }
.help { font-size: .82rem; }
.error { padding: 12px; border: 1px solid var(--status-rose); color: var(--admin-text); }
.actions { display: flex; justify-content: flex-end; gap: 12px; }
button { min-height: 44px; padding: 10px 16px; font: inherit; cursor: pointer; border: 1px solid var(--admin-border-strong); border-radius: 4px; }
.primary { background: var(--admin-heading); color: var(--admin-bg); }
.secondary { background: transparent; color: var(--admin-text); }
button:disabled { opacity: .55; cursor: not-allowed; }
:is(button, input, select):focus-visible { outline: 2px solid var(--admin-heading); outline-offset: 3px; }
@media (max-width: 640px) { .client-entry { align-items: stretch; flex-direction: column; margin: 24px 20px 0; gap: 16px; } .created { margin-inline: 20px; } form { padding: 0 20px 20px; } }
</style>
