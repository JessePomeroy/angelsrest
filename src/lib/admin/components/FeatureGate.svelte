<script lang="ts">
import type { Snippet } from "svelte";
import { type Feature, hasFeature, type Tier } from "$lib/admin/features";
import UpgradeBanner from "./UpgradeBanner.svelte";

interface Props {
	feature: Feature;
	tier: Tier;
	platformUrl?: string;
	siteUrl?: string;
	clientEmail?: string;
	children: Snippet;
}

let { feature, tier, platformUrl, siteUrl, clientEmail, children }: Props =
	$props();
let unlocked = $derived(hasFeature(tier, feature));
</script>

{#if unlocked}
	{@render children()}
{:else}
	<UpgradeBanner {feature} {platformUrl} {siteUrl} {clientEmail} />
{/if}
