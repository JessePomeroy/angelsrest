import { mount } from "svelte";
import "../../../src/lib/styles/global.css";
import EditorPreview from "./EditorPreview.svelte";
import { installPreviewLinks } from "./navigation.svelte";

// Isolated rendering only: never submit, authenticate or contact a provider.
window.fetch = async () => {
	throw new Error("Provider requests are disabled in the editor preview.");
};
document.documentElement.dataset.handbookFixture = "synthetic-admin";
const target = document.getElementById("app");
if (!target) throw new Error("Missing editor preview mount target");
const removePreviewLinks = installPreviewLinks();
import.meta.hot?.dispose(removePreviewLinks);
mount(EditorPreview, { target });
