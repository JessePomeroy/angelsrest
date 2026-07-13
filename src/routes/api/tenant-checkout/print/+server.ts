import { error, json } from "@sveltejs/kit";
import { CheckoutBridgeError, createTenantPrintCheckoutSession } from "$lib/server/checkoutBridge";
import { getCheckoutBridgeTenantConfig } from "$lib/server/checkoutBridgeConfig";
import { getStripe } from "$lib/server/stripeClient";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";

export async function POST({ request }) {
	const bodyText = await request.text();

	try {
		const siteUrl = readSiteUrl(bodyText);
		const tenant = await resolveStripeTenantForSite(siteUrl, {
			requirePlatformClient: true,
		});
		const bridgeConfig = getCheckoutBridgeTenantConfig(tenant.siteUrl);
		if (!bridgeConfig) {
			throw new CheckoutBridgeError(403, "Checkout bridge tenant is not configured");
		}

		const session = await createTenantPrintCheckoutSession({
			bodyText,
			headers: request.headers,
			stripe: getStripe(),
			tenant,
			secrets: bridgeConfig.secrets,
			allowedRedirectOrigins: bridgeConfig.redirectOrigins,
		});

		return json(session);
	} catch (err) {
		if (err instanceof CheckoutBridgeError) {
			throw error(err.status, err.message);
		}
		throw err;
	}
}

function readSiteUrl(bodyText: string): string {
	try {
		const parsed = JSON.parse(bodyText) as { siteUrl?: unknown };
		if (typeof parsed.siteUrl === "string" && parsed.siteUrl) {
			return parsed.siteUrl;
		}
	} catch {
		// Let the shared bridge validator produce the final request error.
	}
	return "";
}
