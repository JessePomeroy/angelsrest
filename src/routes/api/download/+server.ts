import { error } from "@sveltejs/kit";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { issuePaidFile, resolvePaidDownload } from "$lib/server/catalogCommerceClients";
import { isCheckoutSessionOwner } from "$lib/server/checkoutBinding";
import { getConvex } from "$lib/server/convexClient";
import { getStripe } from "$lib/server/stripeClient";
import { getWebhookSecret } from "$lib/server/webhookSecret";

function canonicalSnapshot<T extends { items: readonly object[] }>(snapshot: T) {
	return {
		...snapshot,
		items: snapshot.items.map((item) => {
			const options = item as Record<string, unknown>;
			return {
				...item,
				materialOptionKey: options.materialOptionKey ?? null,
				sizeOptionKey: options.sizeOptionKey ?? null,
				borderOptionKey: options.borderOptionKey ?? null,
				frameOptionKey: options.frameOptionKey ?? null,
			};
		}),
	};
}

function ordinal(value: string | null) {
	const parsed = value === null ? 0 : Number(value);
	if (
		!Number.isSafeInteger(parsed) ||
		parsed < 0 ||
		parsed >= 40 ||
		(value !== null && String(parsed) !== value)
	)
		throw error(400, "Invalid item ordinal");
	return parsed;
}

export async function GET({ url, cookies }) {
	const sessionId = url.searchParams.get("session_id");
	if (!sessionId) throw error(400, "Missing session_id");
	const convex = getConvex();
	const authority = await convex.query(api.orders.resolvePaidDownloadOrder, {
		stripeSessionId: sessionId,
		webhookSecret: getWebhookSecret(),
	});
	if (!authority || authority.refunded || !authority.checkoutSnapshot)
		throw error(409, "Download is not ready");

	let session: Stripe.Checkout.Session;
	try {
		session = await getStripe().checkout.sessions.retrieve(sessionId);
	} catch {
		throw error(400, "Invalid session");
	}
	if (session.payment_status !== "paid") throw error(403, "Payment not completed");
	const emailParam = url.searchParams.get("email")?.toLowerCase();
	if (!isCheckoutSessionOwner(cookies, sessionId)) {
		const sessionEmail = session.customer_details?.email?.toLowerCase();
		if (!emailParam || !sessionEmail || emailParam !== sessionEmail)
			throw error(403, "Access denied");
	}

	const itemIndex = ordinal(url.searchParams.get("item"));
	const snapshot = canonicalSnapshot(authority.checkoutSnapshot);
	if (snapshot.catalogProvider !== "convex") throw error(404, "Download not found");
	const item = snapshot.items[itemIndex];
	if (!item || item.productKind !== "digital_download") throw error(404, "Download not found");
	const resolution = await resolvePaidDownload(sessionId, itemIndex);
	if (
		JSON.stringify(resolution.item) !== JSON.stringify(item) ||
		resolution.identity.productKind !== "digital_download" ||
		resolution.descriptor.kind !== "paid_zip"
	)
		throw error(404, "Download not found");
	const location = await issuePaidFile(resolution.descriptor);
	const race = await convex.query(api.orders.resolvePaidDownloadOrder, {
		stripeSessionId: sessionId,
		webhookSecret: getWebhookSecret(),
	});
	if (
		!race ||
		race.refunded ||
		!race.checkoutSnapshot ||
		JSON.stringify(canonicalSnapshot(race.checkoutSnapshot)) !== JSON.stringify(snapshot)
	)
		throw error(409, "Download is not ready");
	return new Response(null, {
		status: 303,
		headers: {
			Location: location,
			"Cache-Control": "no-store",
			"Referrer-Policy": "no-referrer",
		},
	});
}
