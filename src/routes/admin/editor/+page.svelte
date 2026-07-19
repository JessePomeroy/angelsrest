<script lang="ts">
import {
	LoadingState,
	SiteSettingsPage,
	type SiteSettingsEditorState,
	useAdminClient,
} from "@jessepomeroy/admin";
import { useQuery } from "convex-svelte";
import { api } from "$convex/api";
import { adminConfig } from "$lib/config/admin";
import type { PageData } from "./$types";

let { data }: { data: PageData } = $props();

const editorStateQuery = useQuery(api.content.getSiteSettingsEditorState, {
	siteUrl: adminConfig.siteUrl,
});
const client = useAdminClient();

let startBlank = $state(false);
let seedStatus = $state<"idle" | "saving" | "error">("idle");
let seedError = $state("");
let editorState = $derived(
	editorStateQuery.data as SiteSettingsEditorState | null | undefined,
);

async function copyCurrentSettings() {
	seedStatus = "saving";
	seedError = "";
	try {
		await client.mutation(api.content.saveSiteSettingsDraft, {
			siteUrl: adminConfig.siteUrl,
			payload: data.siteSettingsEditorSeed,
		});
		// Stay on the setup screen until the authenticated reactive query sees
		// the new private draft. The shared page can then initialize from it.
	} catch (error) {
		seedStatus = "error";
		seedError =
			error instanceof Error ? error.message : "Could not copy the current settings.";
	}
}
</script>

{#if editorState === undefined}
	<div class="loading"><LoadingState /></div>
{:else if editorState === null && !startBlank}
	<section class="seed-panel" aria-labelledby="seed-heading">
		<h1 id="seed-heading">set up site settings</h1>
		<p class="description">
			Choose Copy current settings to create a private, unpublished draft in this workspace. The
			public site will not change. Choose Start blank to open empty local fields; nothing is saved
			until you make a change.
		</p>

		<dl>
			<div><dt>artist name</dt><dd>{data.siteSettingsEditorSeed.artistName ?? ""}</dd></div>
			<div><dt>site title</dt><dd>{data.siteSettingsEditorSeed.siteTitle ?? ""}</dd></div>
			<div><dt>tagline</dt><dd>{data.siteSettingsEditorSeed.tagline ?? ""}</dd></div>
			<div>
				<dt>social links</dt>
				<dd>
					{#if (data.siteSettingsEditorSeed.socialLinks?.length ?? 0) > 0}
						<ol>
							{#each data.siteSettingsEditorSeed.socialLinks ?? [] as link, index (index)}
								<li><span>{link.platform}</span> <span>{link.url}</span></li>
							{/each}
						</ol>
					{:else}
						<span>none</span>
					{/if}
				</dd>
			</div>
			<div>
				<dt>SEO description</dt>
				<dd>{data.siteSettingsEditorSeed.seoDescription ?? ""}</dd>
			</div>
		</dl>

		{#if seedError}<p class="error" role="alert">{seedError}</p>{/if}
		<div class="actions">
			<button
				type="button"
				class="primary"
				onclick={() => void copyCurrentSettings()}
				disabled={seedStatus === "saving"}
			>
				{seedStatus === "saving" ? "Copying current settings…" : "Copy current settings"}
			</button>
			<button type="button" onclick={() => (startBlank = true)} disabled={seedStatus === "saving"}>
				Start blank
			</button>
		</div>
		<p class="status" aria-live="polite">
			{seedStatus === "saving"
				? "Creating a private unpublished draft…"
				: "Publishing and preview are not connected; the public site stays on Sanity."}
		</p>
	</section>
{:else}
	<SiteSettingsPage />
{/if}

<style>
	.loading {
		min-height: 45vh;
		display: grid;
		place-items: center;
	}

	.seed-panel {
		max-width: 720px;
		margin: 0 auto;
		padding: 64px 40px 96px;
	}

	h1 {
		margin: 0;
		color: var(--admin-heading);
		font-family: var(--admin-font-display);
		font-size: 1.8rem;
		font-weight: 500;
	}

	.description {
		max-width: 640px;
		margin: 10px 0 28px;
		color: var(--admin-text-muted);
		line-height: 1.65;
	}

	dl {
		margin: 0 0 28px;
		border-top: 1px solid var(--admin-border);
	}

	dl > div {
		display: grid;
		grid-template-columns: 120px 1fr;
		gap: 18px;
		padding: 14px 0;
		border-bottom: 1px solid var(--admin-border);
	}

	dt {
		color: var(--admin-text-subtle);
		font-size: 0.72rem;
	}

	dd {
		margin: 0;
		color: var(--admin-text);
		line-height: 1.5;
		overflow-wrap: anywhere;
	}

	ol {
		display: grid;
		gap: 5px;
		margin: 0;
		padding-left: 20px;
	}

	li span:first-child {
		color: var(--admin-text-muted);
	}

	.actions {
		display: flex;
		gap: 9px;
		flex-wrap: wrap;
	}

	button {
		border: 1px solid var(--admin-border-strong);
		border-radius: 6px;
		padding: 10px 14px;
		background: transparent;
		color: var(--admin-text);
		font: inherit;
		font-size: 0.78rem;
		cursor: pointer;
	}

	button:focus-visible {
		outline: 2px solid var(--admin-accent);
		outline-offset: 2px;
	}

	button:disabled {
		opacity: 0.45;
		cursor: default;
	}

	.primary {
		border-color: transparent;
		background: var(--admin-accent);
		color: var(--admin-bg);
	}

	.status,
	.error {
		margin: 12px 0 0;
		font-size: 0.76rem;
	}

	.status {
		color: var(--admin-text-subtle);
	}

	.error {
		color: var(--status-rose);
	}

	@media (max-width: 768px) {
		.seed-panel {
			padding: 36px 20px 72px;
		}

		dl > div {
			grid-template-columns: 1fr;
			gap: 5px;
		}
	}
</style>
