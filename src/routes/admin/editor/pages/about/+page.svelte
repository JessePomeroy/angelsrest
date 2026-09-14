<script lang="ts">
import { AboutPage, LoadingState } from "@jessepomeroy/admin";
import { useQuery } from "convex-svelte";
import { api } from "$convex/api";
import { adminConfig } from "$lib/config/admin";

const stateQuery = useQuery(api.content.getAboutPageEditorState, {
	siteUrl: adminConfig.siteUrl,
});
let editorState = $derived(stateQuery.data);
</script>

{#if editorState === undefined}
	<LoadingState />
{:else if editorState === null}
	<section class="migration-pending">
		<h1>about</h1>
		<p>The first private About draft will appear here after the fixed migration is reviewed.</p>
	</section>
{:else}
	<div class="about-editor"><AboutPage /></div>
{/if}

<style>
	.migration-pending {
		max-width: 720px;
		margin: 0 auto;
		padding: 64px 40px 96px;
	}

	h1 {
		margin: 0 0 10px;
		color: var(--admin-heading);
		font-family: var(--admin-font-display);
		font-size: 1.8rem;
		font-weight: 500;
	}

	p {
		margin: 0;
		color: var(--admin-text-muted);
		line-height: 1.65;
	}

	/* Initial and subsequent publication remain fixed-pair operator actions. */
	.about-editor :global(.settings-header .actions button.primary) {
		display: none;
	}
</style>
