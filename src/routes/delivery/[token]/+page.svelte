<script lang="ts">
import { setupConvex } from "convex-svelte";
import { PUBLIC_CONVEX_URL } from "$env/static/public";
import PrivateCapabilityHead from "$lib/components/PrivateCapabilityHead.svelte";
import DeliveryGallery from "./DeliveryGallery.svelte";
import type { PageProps } from "./$types";

let { data, form }: Pick<PageProps, "data" | "form"> = $props();
setupConvex(PUBLIC_CONVEX_URL);
// A refreshed snapshot retains active downloads; a new capability disposes them.
const capability = $derived(JSON.stringify([data.gallery._id, data.token, data.accessGrant, data.workerUrl]));
</script>

<PrivateCapabilityHead title="{data.gallery.name} | Gallery" />

{#if data.requiresPassword}
	<section class="password-gate" aria-labelledby="gallery-password-title">
		<h1 id="gallery-password-title">{data.gallery.name}</h1>
		<p>This gallery is password protected.</p>
		<form method="POST" action="?/unlock">
			<label for="gallery-password">gallery password</label>
			<input id="gallery-password" name="password" type="password" autocomplete="current-password" required />
			{#if form?.message}<p class="password-error" role="alert">{form.message}</p>{/if}
			<button type="submit">open gallery</button>
		</form>
	</section>
{:else}
	{#key capability}
		<DeliveryGallery {data} />
	{/key}
{/if}

<style>
	.password-gate {
		max-width: 420px;
		margin: 12vh auto 0;
		padding: 32px 24px;
		font-family: "Synonym", system-ui, sans-serif;
	}
	.password-gate form { display: flex; flex-direction: column; gap: 10px; margin-top: 24px; }
	.password-gate label { font-size: 0.82rem; opacity: 0.7; }
	.password-gate input, .password-gate button {
		padding: 10px 12px;
		border: 1px solid currentColor;
		border-radius: 6px;
		background: transparent;
		color: inherit;
		font: inherit;
	}
	.password-gate button { cursor: pointer; }
	.password-error { margin: 0; color: #ff8d8d; font-size: 0.82rem; }

</style>
