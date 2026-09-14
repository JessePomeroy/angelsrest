<script lang="ts">
import { onMount } from "svelte";
import { loadTurnstile, type TurnstileApi } from "$lib/client/turnstile";
import { TURNSTILE_SITE_KEY } from "$lib/config/turnstile";

let {
	theme = "auto",
	onverified,
	onerror,
	onexpired,
	onloaderror,
}: {
	theme?: "auto" | "light" | "dark";
	onverified: (token: string) => void;
	onerror: (code: string) => void;
	onexpired: () => void;
	onloaderror: (error: unknown) => void;
} = $props();

let container: HTMLDivElement;
let api: TurnstileApi | undefined;
let widgetId: string | undefined;
let disposed = true;

export function reset() {
	if (!disposed && api && widgetId !== undefined) api.reset(widgetId);
}

onMount(() => {
	disposed = false;
	void loadTurnstile()
		.then((loadedApi) => {
			if (disposed) return;
			api = loadedApi;
			widgetId = api.render(container, {
				sitekey: TURNSTILE_SITE_KEY,
				theme,
				action: "turnstile-spin-v1",
				callback: (token) => {
					if (!disposed) onverified(token);
				},
				"error-callback": (code) => {
					if (!disposed) onerror(code);
					return false;
				},
				"expired-callback": () => {
					if (!disposed) onexpired();
				},
			});
		})
		.catch((error: unknown) => {
			if (!disposed) onloaderror(error);
		});

	return () => {
		disposed = true;
		if (api && widgetId !== undefined) api.remove(widgetId);
		widgetId = undefined;
		api = undefined;
	};
});
</script>

<div bind:this={container}></div>
