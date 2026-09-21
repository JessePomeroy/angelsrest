import { error, redirect } from "@sveltejs/kit";
import { normalizeStripeConnectSiteUrl } from "$lib/server/stripeConnectOnboarding";
import { stripeConnectSetupPath } from "$lib/stripeConnectSetup";
import type { RequestEvent } from "./$types";

export function GET({ url }: Pick<RequestEvent, "url">) {
	const siteUrl = normalizeStripeConnectSiteUrl(url.searchParams.get("siteUrl"));
	if (!siteUrl) throw error(400, "A valid client website is required");
	// The authenticated page reads Stripe again; this marker never proves readiness.
	throw redirect(303, `${stripeConnectSetupPath(siteUrl)}?returned=1`);
}
