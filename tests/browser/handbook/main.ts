import { mount } from "svelte";
import "../../../src/lib/styles/global.css";
import Handbook from "./Handbook.svelte";
import HostSessionHandbook from "./HostSessionHandbook.svelte";

// This entry is served only by the isolated handbook Vite config, never by SvelteKit.
// All operational data is invented; even accidental saves cannot reach a provider.
window.fetch = async () => {
	throw new Error("Network operations are disabled in the design handbook fixture.");
};
document.documentElement.dataset.handbookFixture = "synthetic-admin";
const target = document.getElementById("app");
if (!target) throw new Error("Missing handbook fixture mount target");
const component = new URLSearchParams(window.location.search).get("screen") === "session" ? HostSessionHandbook : Handbook;
mount(component, { target });
