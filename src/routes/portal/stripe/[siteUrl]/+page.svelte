<script lang="ts">
import { closeConvex } from "convex-svelte";
import { authClient } from "$lib/auth/client";
import StripeSetupPage from "$lib/components/StripeSetupPage.svelte";
import { stripeConnectSetupPath } from "$lib/stripeConnectSetup";
import type { PageProps } from "./$types";

let { data, form }: PageProps = $props();
async function signOut() {
	const result = await authClient.signOut();
	if (result.error || result.data?.success !== true) throw new Error("Sign-out failed");
	await closeConvex();
	window.location.assign(stripeConnectSetupPath(data.siteUrl));
}
</script>

{#key data.siteUrl}
	<StripeSetupPage {data} {form} {authClient} onSignOut={signOut} />
{/key}
