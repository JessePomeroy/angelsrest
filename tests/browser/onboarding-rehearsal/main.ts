import { mount } from "svelte";
import "../../../src/lib/styles/global.css";
import App from "./App.svelte";
import { currentClient, localNavigate, persist, practice } from "./state.svelte";

// This entry is never imported by the production application.
window.fetch = async () => { throw new Error("Remote requests are disabled in the onboarding rehearsal."); };
const target = document.getElementById("app");
if (!target) throw new Error("Missing rehearsal mount target");

// Keep the real components' native form/link controls, substituting only their transport.
document.addEventListener("submit", (event) => {
	const form = event.target;
	if (!(form instanceof HTMLFormElement) || !form.hasAttribute("action")) return;
	event.preventDefault();
	const action = new URL(form.action, location.href);
	const client = currentClient();
	if (!client || action.origin !== location.origin) return;
	if (action.pathname.startsWith("/portal/stripe/") && action.search === "?/start") {
		if (practice.signedInEmail !== client.email) return;
		client.stripeConnectedAccountId ??= `acct_practice_${client._id}`;
		client.stripeStatus ??= "setup_required";
		persist();
		localNavigate(`/__rehearsal/stripe/${encodeURIComponent(client.siteUrl)}`);
	} else if (action.pathname.startsWith("/admin/platform/lumaprints/") && action.search === "?/connect") {
		const fields = new FormData(form);
		if (fields.get("connectionRef") !== "practice-client-store" || !fields.has("accountOwnershipConfirmed") || !fields.has("billingConfirmed")) return;
		client.supplierConnected = true;
		persist();
		window.location.reload();
	}
}, true);
document.addEventListener("click", (event) => {
	if (!(event.target instanceof Element)) return;
	const link = event.target.closest("a[href]");
	if (!(link instanceof HTMLAnchorElement)) return;
	const url = new URL(link.href);
	if (url.origin !== location.origin) {
		event.preventDefault();
		if (url.hostname === "dashboard.stripe.com") localNavigate(`/__rehearsal/dashboard/${encodeURIComponent(currentClient()?.siteUrl ?? "")}`);
		if (url.hostname === "dashboard.lumaprints.com") localNavigate(`/__rehearsal/lumaprints/${encodeURIComponent(currentClient()?.siteUrl ?? "")}`);
		return;
	}
	if (url.pathname.startsWith("/portal/stripe/") && currentClient()?.stripeStatus === "pending_verification") {
		const client = currentClient();
		if (client && practice.signedInEmail === client.email) { client.stripeStatus = "ready"; persist(); }
	}
});
mount(App, { target });
