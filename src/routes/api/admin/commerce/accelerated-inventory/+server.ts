import { error, json } from "@sveltejs/kit";
import type Stripe from "stripe";
import { api } from "$convex/api";
import { env } from "$env/dynamic/private";
import { getConvex } from "$lib/server/convexClient";
import { authorizeR4ReadRequest, r4ReadPurposes } from "$lib/server/r4ReadAuthorization";
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
const acceptedOwnerTestProfiles = [
	{
		createdDay: "2026-02-15",
		amountTotalMinor: 100,
		currency: "usd",
		customerEmailMasked: "th***@gmail.com",
		occurrences: 6,
	},
	{
		createdDay: "2026-03-06",
		amountTotalMinor: 100,
		currency: "usd",
		customerEmailMasked: "th***@gmail.com",
		occurrences: 1,
	},
	{
		createdDay: "2026-03-07",
		amountTotalMinor: 100,
		currency: "usd",
		customerEmailMasked: "th***@gmail.com",
		occurrences: 16,
	},
	{
		createdDay: "2026-03-09",
		amountTotalMinor: 100,
		currency: "usd",
		customerEmailMasked: "th***@gmail.com",
		occurrences: 15,
	},
] as const;

export async function POST({ request }: { request: Request }) {
	const authorization = await authorizeR4ReadRequest(request, r4ReadPurposes.acceleratedInventory);
	if (!authorization) {
		throw error(401, "Unauthorized");
	}
	let body: unknown;
	try {
		body = JSON.parse(authorization.rawBody) as unknown;
	} catch {
		throw error(400, "Invalid request");
	}
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
	if (
		result.scanClass === "complete" &&
		result.blockerClasses.length === 1 &&
		result.blockerClasses[0] === "historical_paid_unresolved"
	) {
		const diagnostic = await legacyPaidDiagnostic(convex);
		if (ownerTestDispositionMatches(diagnostic)) {
			return json({
				...result,
				outcome: "clear" as const,
				evidenceClasses: [
					...new Set([...result.evidenceClasses, "owner_test_history_disposition_verified"]),
				].sort(),
				blockerClasses: [],
			});
		}
	}
	return json(result, { status: result.outcome === "clear" ? 200 : 409 });
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
	const profileCounts = new Map<
		string,
		{
			createdDay: string;
			amountTotalMinor: number | null;
			currency: string | null;
			customerEmailMasked: string | null;
			occurrences: number;
		}
	>();
	let candidateCount = 0;
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
			candidateCount += 1;
			if (candidateCount > 10_000) throw error(409, "Diagnostic candidate cap reached");
			const profile = {
				createdDay: new Date(session.created * 1_000).toISOString().slice(0, 10),
				amountTotalMinor: session.amount_total,
				currency: session.currency,
				customerEmailMasked: maskEmail(session.customer_details?.email ?? session.customer_email),
			};
			const key = JSON.stringify(profile);
			const existing = profileCounts.get(key);
			profileCounts.set(key, { ...profile, occurrences: (existing?.occurrences ?? 0) + 1 });
		}
		if (!page.has_more) {
			return {
				version: 1 as const,
				outcome: "diagnostic" as const,
				candidateCount,
				profiles: [...profileCounts.values()].sort((left, right) =>
					left.createdDay.localeCompare(right.createdDay),
				),
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

function ownerTestDispositionMatches(diagnostic: Awaited<ReturnType<typeof legacyPaidDiagnostic>>) {
	return (
		diagnostic.candidateCount === 38 &&
		diagnostic.profiles.length === acceptedOwnerTestProfiles.length &&
		diagnostic.profiles.every((profile, index) => {
			const expected = acceptedOwnerTestProfiles[index];
			return (
				expected !== undefined &&
				profile.createdDay === expected.createdDay &&
				profile.amountTotalMinor === expected.amountTotalMinor &&
				profile.currency === expected.currency &&
				profile.customerEmailMasked === expected.customerEmailMasked &&
				profile.occurrences === expected.occurrences
			);
		})
	);
}
