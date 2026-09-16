<script lang="ts">
import { onMount } from "svelte";

const { onverified, onerror, onexpired, onloaderror }: {
	theme?: "auto" | "light" | "dark";
	onverified: (token: string) => void;
	onerror: (code: string) => void;
	onexpired: () => void;
	onloaderror: (error: unknown) => void;
} = $props();
let verified = $state(false);
export function reset() { verified = false; }
onMount(() => {
	const state = new URLSearchParams(window.location.search).get("state");
	if (state === "verification_error") onerror("simulated");
	else if (state === "verification_expired") onexpired();
	else if (state === "verification_unavailable") onloaderror(new Error("Simulated provider load failure"));
	else if (state !== "unverified") {
		verified = true;
		onverified("handbook-local-placeholder-not-a-provider-token");
	}
});
</script>

<div class="verification-fixture">
	Verification area · simulated provider
	<input type="hidden" name="cf-turnstile-response" value={verified ? "handbook-local-placeholder-not-a-provider-token" : ""} />
</div>

<style>
.verification-fixture { display: flex; align-items: center; min-height: 65px; padding: 12px; border: 1px dashed currentColor; font-size: 12px; }
</style>
