import { mount } from "svelte";
import PublicHandbook from "./PublicHandbook.svelte";

const params = new URLSearchParams(window.location.search);
window.fetch = async (input, init) => {
	if (params.get("screen") === "contact" && input === "/api/contact" && init?.method === "POST") {
		document.documentElement.dataset.handbookContactRequest = "simulated-only";
		if (params.get("state") === "sending") return new Promise<Response>(() => {});
		return new Response(null, { status: params.get("state") === "success" ? 200 : 503 });
	}
	throw new Error("Provider operations are disabled in the synthetic public handbook fixture.");
};
document.documentElement.dataset.handbookFixture = "synthetic-public";
const target = document.getElementById("app");
if (!target) throw new Error("Missing public handbook fixture mount target");
mount(PublicHandbook, { target });
