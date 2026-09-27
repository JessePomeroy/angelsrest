import { error, isHttpError, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { CheckoutBridgeError, verifyCheckoutBridgeSignature } from "$lib/server/checkoutBridge";
import { getCheckoutBridgeTenantConfig } from "$lib/server/checkoutBridgeConfig";
import { isCheckoutSnapshotReservationConflict } from "$lib/server/checkoutSnapshotReservationClient";
import { NewOrderCheckoutClosedError } from "$lib/server/commercePurposeControls";
import { getStripe } from "$lib/server/stripeClient";
import { ClientPaymentUnavailableError } from "$lib/server/stripeConnect";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";
import { createTenantCartCheckoutSession } from "$lib/server/tenantCartCheckout";

export async function POST({ request }) {
	const reader = request.body?.getReader();
	if (!reader) throw error(400, "Missing checkout request");
	const chunks: Uint8Array[] = [];
	let length = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) break;
		length += value.byteLength;
		if (length > 64 * 1024) {
			await reader.cancel();
			throw error(413, "Checkout request is too large");
		}
		chunks.push(value);
	}
	const bodyText = Buffer.concat(chunks).toString("utf8");

	try {
		const { siteUrl, bridgeConfig } = authorizeBridgeRequest(bodyText, request.headers);
		const tenant = await resolveStripeTenantForSite(siteUrl, {
			requirePlatformClient: true,
		});

		const session = await createTenantCartCheckoutSession({
			bodyText,
			headers: request.headers,
			stripe: getStripe(),
			tenant,
			secrets: bridgeConfig.secrets,
			allowedRedirectOrigins: bridgeConfig.redirectOrigins,
			snapshotMode: bridgeConfig.snapshotMode,
			globalSnapshotMode: env.CHECKOUT_SNAPSHOT_MODE,
		});

		return json(session);
	} catch (err) {
		if (
			isHttpError(err, 409) &&
			"details" in err.body &&
			err.body.details &&
			typeof err.body.details === "object" &&
			"attemptState" in err.body.details &&
			err.body.details.attemptState === "released_definite_no_session"
		)
			return json(
				{
					code: "CHECKOUT_NEW_ATTEMPT_ALLOWED",
					message: "No payment session was created. Start a new checkout when ready.",
				},
				{ status: 409 },
			);
		if (err instanceof ClientPaymentUnavailableError) throw error(503, err.message);
		if (err instanceof NewOrderCheckoutClosedError) {
			throw error(503, "Checkout is temporarily unavailable");
		}
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
