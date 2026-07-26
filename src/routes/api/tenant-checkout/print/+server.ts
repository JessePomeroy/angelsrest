import { error, json } from "@sveltejs/kit";
import {
	CheckoutBridgeError,
	createTenantPrintCheckoutSession,
	verifyCheckoutBridgeSignature,
} from "$lib/server/checkoutBridge";
import { getCheckoutBridgeTenantConfig } from "$lib/server/checkoutBridgeConfig";
import { isCheckoutSnapshotReservationConflict } from "$lib/server/checkoutSnapshotReservationClient";
import { getStripe } from "$lib/server/stripeClient";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";

export async function POST({ request }) {
	const bodyText = await request.text();

	try {
		const { siteUrl, bridgeConfig } = authorizeBridgeRequest(bodyText, request.headers);
		const tenant = await resolveStripeTenantForSite(siteUrl, {
			requirePlatformClient: true,
		});

		const session = await createTenantPrintCheckoutSession({
			bodyText,
			headers: request.headers,
			stripe: getStripe(),
			tenant,
			secrets: bridgeConfig.secrets,
			allowedRedirectOrigins: bridgeConfig.redirectOrigins,
			snapshotMode: bridgeConfig.snapshotMode,
		});

		return json(session);
	} catch (err) {
		if (err instanceof CheckoutBridgeError) {
			throw error(err.status, err.message);
		}
		if (isCheckoutSnapshotReservationConflict(err)) throw error(409, "Checkout attempt rejected");
		throw err;
	}
}

function authorizeBridgeRequest(bodyText: string, headers: Headers) {
	try {
		const siteUrl = readSiteUrl(bodyText);
		const bridgeConfig = getCheckoutBridgeTenantConfig(siteUrl);
		if (!bridgeConfig) throw new Error("Unknown checkout bridge tenant");
		verifyCheckoutBridgeSignature({
			bodyText,
			headers,
			secrets: bridgeConfig.secrets,
			now: Date.now(),
		});
		return { siteUrl, bridgeConfig };
	} catch {
		throw new CheckoutBridgeError(401, "Unauthorized checkout bridge request");
	}
}

function readSiteUrl(bodyText: string): string {
	try {
		const parsed = JSON.parse(bodyText) as { siteUrl?: unknown };
		if (typeof parsed.siteUrl === "string" && parsed.siteUrl) {
			return parsed.siteUrl;
		}
	} catch {
		// Authentication returns the same response for malformed and unknown tenants.
	}
	return "";
}
