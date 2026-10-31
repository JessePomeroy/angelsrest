import { readCheckoutConfirmation } from "@jessepomeroy/admin/server/customer-services";
import { error, json } from "@sveltejs/kit";
import { verifyCheckoutBridgeSignature } from "$lib/server/checkoutBridge";
import { getCheckoutBridgeTenantConfig } from "$lib/server/checkoutBridgeConfig";
import { getStripe } from "$lib/server/stripeClient";
import {
	COMMERCE_TENANT_ID_METADATA_KEY,
	COMMERCE_TENANT_METADATA_KEY,
} from "$lib/server/stripeConnect";
import { resolveStripeTenantForSite } from "$lib/server/stripeTenant";

/** Read only: existing payments stay confirmable after new checkout is closed. */
export async function POST({ request }: { request: Request }) {
	const reader = request.body?.getReader();
	if (!reader) error(400, "Missing confirmation request");
	const chunks: Uint8Array[] = [];
	let size = 0;
	for (;;) {
		const { done, value } = await reader.read();
		if (done) break;
		size += value.length;
		if (size > 8192) {
			await reader.cancel();
			error(413, "Confirmation request too large");
		}
		chunks.push(value);
	}
	const text = Buffer.concat(chunks).toString("utf8");
	let body: unknown;
	try {
		body = JSON.parse(text);
	} catch {
		error(400, "Invalid confirmation request");
	}
	if (
		!body ||
		typeof body !== "object" ||
		!("siteUrl" in body) ||
		!("sessionId" in body) ||
		typeof body.siteUrl !== "string" ||
		typeof body.sessionId !== "string" ||
		!/^cs_(?:test_|live_)?[a-zA-Z0-9]{1,240}$/.test(body.sessionId) ||
		Object.keys(body).some((key) => key !== "siteUrl" && key !== "sessionId")
	)
		error(400, "Invalid confirmation request");
	try {
		const config = getCheckoutBridgeTenantConfig(body.siteUrl);
		if (!config) throw new Error("Unknown tenant");
		verifyCheckoutBridgeSignature({
			bodyText: text,
			headers: request.headers,
			secrets: config.secrets,
			now: Date.now(),
		});
	} catch {
		error(401, "Unauthorized confirmation request");
	}
	try {
		const tenant = await resolveStripeTenantForSite(body.siteUrl, { requirePlatformClient: true });
		const options = tenant.stripeConnectedAccountId
			? { stripeAccount: tenant.stripeConnectedAccountId }
			: undefined;
		const stripe = getStripe();
		const session = await stripe.checkout.sessions.retrieve(body.sessionId, {}, options);
		if (
			session.metadata?.[COMMERCE_TENANT_METADATA_KEY] !== tenant.siteUrl ||
			(tenant.tenantId && session.metadata?.[COMMERCE_TENANT_ID_METADATA_KEY] !== tenant.tenantId)
		)
			error(404, "Checkout not found");
		const lines = await stripe.checkout.sessions.listLineItems(session.id, { limit: 100 }, options);
		if (lines.has_more) throw new Error("Incomplete checkout items");
		const result = readCheckoutConfirmation({
			paymentStatus: session.payment_status === "paid" ? "paid" : "unpaid",
			amountTotal: session.amount_total,
			currency: session.currency,
			items: lines.data.map((item) => ({
				description: item.description,
				quantity: item.quantity,
				amount: item.amount_total,
			})),
		});
		return json(result, {
			headers: { "cache-control": "private, no-store", "referrer-policy": "no-referrer" },
		});
	} catch {
		error(503, "Checkout confirmation is temporarily unavailable");
	}
}
