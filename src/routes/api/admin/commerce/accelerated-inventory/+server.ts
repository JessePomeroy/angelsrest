import { createHmac, timingSafeEqual } from "node:crypto";
import { error, json } from "@sveltejs/kit";
import type Stripe from "stripe";
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
const inventoryAuthorization = "r4_accelerated_fixed_point_read_v1";
const diagnosticAuthorization = "r4_accelerated_legacy_paid_diagnostic_v1";
const hmacMessagePrefix = "r4-accelerated-inventory-v1:";
const maxClockSkewSeconds = 300;

export async function POST({ request }: { request: Request }) {
	if (!(await authorizeRequest(request))) throw error(401, "Unauthorized");
	const body = await request.json().catch(() => null);
	const requestedAuthorization = exactAuthorization(body);
	if (!requestedAuthorization) throw error(400, "Invalid request");
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
	if (requestedAuthorization === diagnosticAuthorization) {
		if (
			result.scanClass !== "complete" ||
			result.blockerClasses.some((value) => value !== "historical_paid_unresolved")
		) {
			return json(result, { status: 409 });
		}
		return json(await legacyPaidDiagnostic(convex));
	}
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

function exactAuthorization(value: unknown) {
	if (
		value === null ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).length !== 1
	)
		return null;
	const valueAuthorization = (value as { authorization?: unknown }).authorization;
	return valueAuthorization === inventoryAuthorization ||
		valueAuthorization === diagnosticAuthorization
		? valueAuthorization
		: null;
}

async function legacyPaidDiagnostic(convex: ReturnType<typeof getConvex>) {
	const stripe = getStripe();
	const profiles: Array<{
		createdDay: string;
		amountTotalMinor: number | null;
		currency: string | null;
		customerEmailMasked: string | null;
		lineItems: Array<{ description: string; quantity: number | null; amountTotalMinor: number }>;
	}> = [];
	let startingAfter: string | undefined;
	for (let pageNumber = 0; pageNumber < 10_000; pageNumber += 1) {
		const page = await stripe.checkout.sessions.list({
			limit: 100,
			...(startingAfter ? { starting_after: startingAfter } : {}),
		});
		for (const session of page.data) {
			if (!isHistoricalPaidOrderCandidate(session)) continue;
			const marker = session.metadata?.commerceTenantSiteUrl;
			const args = {
				stripeSessionId: session.id,
				...(marker ? { stripeTenantMetadataSiteUrl: marker } : {}),
				webhookSecret: env.WEBHOOK_SECRET as string,
			};
			const routed = await convex.query(api.orders.resolveCheckoutRouting, args);
			const admission = routed
				? null
				: await convex.query(api.orders.resolveCheckoutAdmissionRouting, args);
			if (routed || admission) continue;
			if (profiles.length >= 10) throw error(409, "Diagnostic candidate cap reached");
			const full = await stripe.checkout.sessions.retrieve(session.id, {
				expand: ["customer_details", "line_items"],
			});
			profiles.push({
				createdDay: new Date(full.created * 1_000).toISOString().slice(0, 10),
				amountTotalMinor: full.amount_total,
				currency: full.currency,
				customerEmailMasked: maskEmail(full.customer_details?.email ?? full.customer_email),
				lineItems: (full.line_items?.data ?? []).map((item) => ({
					description: (item.description ?? "unknown").slice(0, 120),
					quantity: item.quantity,
					amountTotalMinor: item.amount_total,
				})),
			});
		}
		if (!page.has_more) {
			return {
				version: 1 as const,
				outcome: "diagnostic" as const,
				candidateCount: profiles.length,
				profiles,
			};
		}
		startingAfter = page.data.at(-1)?.id;
		if (!startingAfter) throw error(409, "Diagnostic pagination is incomplete");
	}
	throw error(409, "Diagnostic page cap reached");
}

function isHistoricalPaidOrderCandidate(session: Stripe.Checkout.Session) {
	const metadata = session.metadata ?? {};
	const orderShape =
		metadata.productId !== undefined ||
		metadata.isCart === "true" ||
		Object.keys(metadata).some(
			(key) => key.startsWith("checkoutSnapshot") || key.startsWith("checkoutAdmission"),
		);
	return (
		session.livemode === true &&
		session.mode === "payment" &&
		metadata.type === undefined &&
		(metadata.commerceTenantSiteUrl === undefined ||
			metadata.commerceTenantSiteUrl === targetSite) &&
		orderShape &&
		(session.payment_status === "paid" || session.payment_status === "no_payment_required")
	);
}

function maskEmail(value: string | null | undefined) {
	if (!value) return null;
	const separator = value.lastIndexOf("@");
	if (separator <= 0 || separator === value.length - 1) return "invalid";
	const local = value.slice(0, separator);
	const domain = value.slice(separator + 1).toLowerCase();
	return `${local.slice(0, Math.min(2, local.length))}***@${domain}`;
}
