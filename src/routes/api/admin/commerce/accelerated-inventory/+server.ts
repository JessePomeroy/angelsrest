import { createHmac, timingSafeEqual } from "node:crypto";
import { error, json } from "@sveltejs/kit";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { getConvex } from "$lib/server/convexClient";
import { verifySiteAdminRequest } from "$lib/server/siteAdminAuthorization";
import { getStripe } from "$lib/server/stripeClient";
import {
	type InventoryRoute,
	type InventorySession,
	inventoryCheckoutSessionsAtFixedPoint,
} from "../../../../../../scripts/commerce/r4-checkout-session-inventory-core";

export const config = { maxDuration: 60 };

const targetSite = "angelsrest.online";
const authorization = "r4_accelerated_fixed_point_read_v1";
const hmacMessagePrefix = "r4-accelerated-inventory-v1:";
const maxClockSkewSeconds = 300;

export async function POST({ request }: { request: Request }) {
	if (!(await authorizeRequest(request))) throw error(401, "Unauthorized");
	const body = await request.json().catch(() => null);
	if (!exactAuthorization(body)) throw error(400, "Invalid request");
	if (!env.WEBHOOK_SECRET) throw error(503, "Inventory configuration is incomplete");

	const convex = getConvex();
	const cutoff = await convex.query(api.commerceClosure.getProtocolCutoffForInventory, {
		siteUrl: targetSite,
		webhookSecret: env.WEBHOOK_SECRET,
	});
	if (!cutoff || cutoff.accountScopeClass !== "platform") {
		throw error(503, "Inventory configuration is incomplete");
	}

	const result = await inventoryCheckoutSessionsAtFixedPoint({
		stripe: {
			list: (input) =>
				getStripe().checkout.sessions.list(input) as Promise<{
					data: InventorySession[];
					has_more: boolean;
				}>,
		},
		routing: {
			async resolve(session): Promise<InventoryRoute> {
				const marker = session.metadata?.commerceTenantSiteUrl;
				const args = {
					stripeSessionId: session.id,
					...(marker ? { stripeTenantMetadataSiteUrl: marker } : {}),
					webhookSecret: env.WEBHOOK_SECRET as string,
				};
				const routed = await convex.query(api.orders.resolveCheckoutRouting, args);
				if (routed) return routed.source;
				const admission = await convex.query(api.orders.resolveCheckoutAdmissionRouting, args);
				return admission ? "admission" : null;
			},
		},
		cutoffCreatedSeconds: cutoff.cutoffCreatedSeconds,
		acceptUntilMs: cutoff.acceptUntilMs,
		nowMs: Date.now(),
		targetSite,
	});
	return json(result, { status: result.outcome === "clear" ? 200 : 409 });
}

async function authorizeRequest(request: Request) {
	if (await verifySiteAdminRequest(request)) return true;
	if (!env.WEBHOOK_SECRET) return false;
	const timestampText = request.headers.get("x-r4-timestamp");
	const supplied = request.headers.get("x-r4-signature");
	if (
		!timestampText ||
		!supplied ||
		!/^\d{10}$/.test(timestampText) ||
		!/^[0-9a-f]{64}$/.test(supplied)
	) {
		return false;
	}
	const timestamp = Number(timestampText);
	const nowSeconds = Math.floor(Date.now() / 1_000);
	if (!Number.isSafeInteger(timestamp) || Math.abs(nowSeconds - timestamp) > maxClockSkewSeconds) {
		return false;
	}
	const expected = createHmac("sha256", env.WEBHOOK_SECRET)
		.update(`${hmacMessagePrefix}${timestampText}`)
		.digest();
	return timingSafeEqual(expected, Buffer.from(supplied, "hex"));
}

function exactAuthorization(value: unknown): value is { authorization: typeof authorization } {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === 1 &&
		(value as { authorization?: unknown }).authorization === authorization
	);
}
