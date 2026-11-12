import { mount } from "svelte";
import "../../../src/lib/styles/global.css";
import EditorPreview from "./EditorPreview.svelte";
import { installPreviewLinks } from "./navigation.svelte";

// Isolated rendering only: never submit, authenticate or contact a provider.
// Admin mutations use the HTTP proxy, so keep their simulated save failure.
window.fetch = async (input) => {
	if (String(input instanceof Request ? input.url : input).endsWith("/api/admin/mutation")) {
		throw new Error("Simulated save failure: provider writes are disabled in handbook fixtures.");
	}
	throw new Error("Provider requests are disabled in the editor preview.");
};
document.documentElement.dataset.handbookFixture = "synthetic-admin";
const target = document.getElementById("app");
if (!target) throw new Error("Missing editor preview mount target");
const removePreviewLinks = installPreviewLinks();
import.meta.hot?.dispose(removePreviewLinks);
mount(EditorPreview, { target });
