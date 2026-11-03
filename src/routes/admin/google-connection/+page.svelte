<script lang="ts">
import { onMount } from "svelte";
import { page } from "$app/state";
import { connectionMessage, connectionReference, connectionReturnPath, googleCallbackCode } from "$lib/gmailConnection";
let message = $state("Finishing your optional Gmail connection…");
let pending = $state(true);
let reference = $state<string | null>(null);
let returnTo = $state("/admin/inquiries");
onMount(() => {
	let active = true;
	if (page.url.searchParams.has("gmail_error")) {
		message = connectionMessage(page.url.searchParams.get("gmail_error"));
		reference = connectionReference(page.url.searchParams.get("gmail_ref"));
		returnTo = connectionReturnPath(page.url.searchParams.get("returnTo"));
		pending = false;
		return;
	}
	if (page.url.searchParams.has("error") || page.url.searchParams.get("google_link") === "error") {
		message = connectionMessage(googleCallbackCode(page.url.searchParams.get("error")));
		pending = false;
		return;
	}
	void (async () => {
		try {
			const response = await fetch("/api/admin/gmail/complete-linked", { method: "POST" });
			const result: unknown = await response.json();
			if (!active) return;
			if (!result || typeof result !== "object") throw new Error();
			if (!response.ok) {
				message = response.status === 403 ? "Your administrator session or site access is no longer available. Sign in again before checking Gmail status." : connectionMessage("code" in result ? result.code : null);
				reference = connectionReference("reference" in result ? result.reference : null);
				returnTo = connectionReturnPath("returnTo" in result ? result.returnTo : null);
				pending = false;
				return;
			}
			if (!("returnTo" in result) || typeof result.returnTo !== "string") throw new Error();
			if ("connected" in result && result.connected === false) {
				message = connectionMessage("missing_permissions");
				pending = false;
				return;
			}
			if (!("connected" in result) || result.connected !== true) throw new Error();
			const target = new URL(result.returnTo, window.location.origin);
			if (target.origin !== window.location.origin || !["/admin/inquiries", "/admin/crm"].includes(target.pathname)) throw new Error();
			window.location.replace(target.pathname + target.search);
		} catch {
			if (active) { message = connectionMessage("server_failure"); pending = false; }
		}
	})();
	return () => { active = false; };
});
</script>
<svelte:head><title>Google connection · admin</title><meta name="robots" content="noindex,nofollow" /></svelte:head>
<section aria-label="Google connection" class="connection-result">
 <h1>google connection</h1>
 <p role="status">{message}</p>
 {#if !pending}
  <p>Gmail access is separate from your administrator sign-in.</p>
  {#if reference}<p>Support reference: <code>{reference}</code></p>{/if}
  <a href={returnTo}>return to {returnTo.startsWith("/admin/crm") ? "clients" : "inquiries"}</a>
 {/if}
</section>
<style>
.connection-result { padding: 32px; max-width: 65ch; color: var(--admin-text); font-family: inherit; }
h1 { color: var(--admin-heading); font-size: 1.25rem; font-weight: 500; }
p { line-height: 1.6; } a { color: var(--admin-accent); text-underline-offset: 3px; }
</style>
