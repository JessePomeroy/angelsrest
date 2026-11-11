import { mount } from "svelte";
import "../../../src/lib/styles/global.css";
import StripeSetupHarness from "../fixtures/StripeSetupHarness.svelte";
import Handbook from "./Handbook.svelte";
import HostSessionHandbook from "./HostSessionHandbook.svelte";

// This entry is served only by the isolated handbook Vite config, never by SvelteKit.
// All operational data is invented; even accidental saves cannot reach a provider.
// Admin mutations use the HTTP proxy, so keep their simulated save failure.
window.fetch = async (input) => {
	if (String(input instanceof Request ? input.url : input).endsWith("/api/admin/mutation")) {
		throw new Error("Simulated save failure: provider writes are disabled in handbook fixtures.");
	}
	throw new Error("Network operations are disabled in the design handbook fixture.");
};
document.documentElement.dataset.handbookFixture = "synthetic-admin";
const target = document.getElementById("app");
if (!target) throw new Error("Missing handbook fixture mount target");
const screen = new URLSearchParams(window.location.search).get("screen");
const component = screen === "stripe-setup" ? StripeSetupHarness : screen === "session" ? HostSessionHandbook : Handbook;
mount(component, { target });
