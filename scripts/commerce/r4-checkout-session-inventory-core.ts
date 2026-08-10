import type Stripe from "stripe";

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10_000;
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{15,120}$/;
const ADMISSION_HASH = /^[0-9a-f]{64}$/;

export type InventorySession = Pick<
	Stripe.Checkout.Session,
	"id" | "created" | "expires_at" | "livemode" | "metadata" | "mode" | "payment_status" | "status"
>;

export interface InventoryStripeClient {
	list(input: { limit: number; starting_after?: string }): Promise<{
		data: InventorySession[];
		has_more: boolean;
	}>;
}

export type InventoryRoute = "order" | "retired" | "reservation" | "admission" | null;

export interface InventoryRoutingClient {
	resolve(session: InventorySession): Promise<InventoryRoute>;
}

export interface InventoryResult {
	version: 1;
	outcome: "clear" | "incomplete";
	scanClass: "complete" | "provider_error" | "scan_cap" | "pagination_invalid" | "head_shifted";
	evidenceClasses: string[];
	blockerClasses: string[];
}

export async function inventoryCheckoutSessions({
	stripe,
	routing,
	cutoffCreatedSeconds,
	acceptUntilMs,
	nowMs,
	targetSite = "angelsrest.online",
	knownSites = ["angelsrest.online", "zippymiggy.com"],
	maxPages = DEFAULT_MAX_PAGES,
}: {
	stripe: InventoryStripeClient;
	routing: InventoryRoutingClient;
	cutoffCreatedSeconds: number;
	acceptUntilMs: number;
	nowMs: number;
	targetSite?: string;
	knownSites?: readonly string[];
	maxPages?: number;
}): Promise<InventoryResult> {
	const cutoffMs = cutoffCreatedSeconds * 1_000;
	if (
		!Number.isSafeInteger(cutoffCreatedSeconds) ||
		cutoffCreatedSeconds < 0 ||
		!Number.isSafeInteger(cutoffMs) ||
		!Number.isSafeInteger(acceptUntilMs) ||
		acceptUntilMs !== cutoffMs + 3_222_000_000 ||
		!Number.isSafeInteger(nowMs) ||
		nowMs < acceptUntilMs ||
		!Number.isSafeInteger(maxPages) ||
		maxPages < 1
	)
		return incomplete("pagination_invalid", ["cutoff_or_horizon_invalid"]);

	const blockers = new Set<string>();
	const evidence = new Set<string>();
	const seen = new Set<string>();
	let firstPage: Awaited<ReturnType<InventoryStripeClient["list"]>>;
	try {
		firstPage = await stripe.list({ limit: PAGE_SIZE });
	} catch {
		return incomplete("provider_error", ["provider_error"]);
	}
	const anchorHead = firstPage.data[0]?.id ?? null;
	let page = firstPage;
	let pages = 0;

	while (true) {
		pages += 1;
		if (pages > maxPages) return incomplete("scan_cap", ["scan_cap"]);
		if (!validPage(page)) return incomplete("pagination_invalid", ["pagination_invalid"]);

		for (const session of page.data) {
			if (seen.has(session.id)) return incomplete("pagination_invalid", ["pagination_duplicate"]);
			seen.add(session.id);
			await classifySession({
				session,
				routing,
				cutoffCreatedSeconds,
				nowMs,
				targetSite,
				knownSites,
				blockers,
				evidence,
			});
		}

		if (!page.has_more) break;
		const cursor = page.data.at(-1)?.id;
		if (!cursor) return incomplete("pagination_invalid", ["pagination_empty_more"]);
		try {
			page = await stripe.list({ limit: PAGE_SIZE, starting_after: cursor });
		} catch {
			return incomplete("provider_error", ["provider_error"]);
		}
	}

	let reread: Awaited<ReturnType<InventoryStripeClient["list"]>>;
	try {
		reread = await stripe.list({ limit: PAGE_SIZE });
	} catch {
		return incomplete("provider_error", ["head_reread_error"]);
	}
	if (!validPage(reread) || (reread.data[0]?.id ?? null) !== anchorHead) {
		return incomplete("head_shifted", ["head_shifted"]);
	}

	evidence.add("full_history_paginated");
	evidence.add("head_reread_stable");
	return {
		version: 1,
		outcome: blockers.size === 0 ? "clear" : "incomplete",
		scanClass: "complete",
		evidenceClasses: [...evidence].sort(),
		blockerClasses: [...blockers].sort(),
	};
}

async function classifySession({
	session,
	routing,
	cutoffCreatedSeconds,
	nowMs,
	targetSite,
	knownSites,
	blockers,
	evidence,
}: {
	session: InventorySession;
	routing: InventoryRoutingClient;
	cutoffCreatedSeconds: number;
	nowMs: number;
	targetSite: string;
	knownSites: readonly string[];
	blockers: Set<string>;
	evidence: Set<string>;
}) {
	if (
		!SESSION_ID.test(session.id) ||
		session.livemode !== true ||
		!Number.isSafeInteger(session.created) ||
		session.created < 0 ||
		!Number.isSafeInteger(session.expires_at) ||
		session.expires_at < session.created
	) {
		blockers.add("provider_projection_invalid");
		return;
	}
	const metadata = session.metadata ?? {};
	if (metadata.type === "invoice_payment" || metadata.type === "platform_subscription") {
		evidence.add("retained_non_order_checkout_observed");
		return;
	}
	if (metadata.type !== undefined) {
		blockers.add("unknown_legacy_purpose");
		return;
	}
	const marker = metadata.commerceTenantSiteUrl;
	if (marker && marker !== targetSite) {
		if (!knownSites.includes(marker)) blockers.add("unknown_tenant_marker");
		else evidence.add("other_known_tenant_excluded");
		return;
	}
	if (
		session.mode !== "payment" ||
		!(["paid", "unpaid", "no_payment_required"] as const).includes(session.payment_status) ||
		!(["open", "complete", "expired", null] as const).includes(session.status)
	) {
		blockers.add("provider_projection_invalid");
		return;
	}
	const legacyOrderShape =
		metadata.productId !== undefined ||
		metadata.isCart === "true" ||
		Object.keys(metadata).some(
			(key) => key.startsWith("checkoutSnapshot") || key.startsWith("checkoutAdmission"),
		);
	if (marker !== targetSite && !legacyOrderShape) {
		blockers.add("unknown_legacy_purpose");
		return;
	}

	const admissionMarked =
		metadata.checkoutAdmissionVersion === "1" &&
		ADMISSION_HASH.test(metadata.checkoutAdmissionHandleHash ?? "");
	if (session.created >= cutoffCreatedSeconds && !admissionMarked) {
		blockers.add("post_cutoff_missing_admission");
	}

	let route: InventoryRoute;
	try {
		route = await routing.resolve(session);
	} catch {
		blockers.add("routing_error");
		return;
	}
	if (route === "order" || route === "retired") {
		evidence.add(route === "order" ? "stored_order_resolved" : "retired_order_resolved");
		return;
	}
	if (route === "reservation" || route === "admission") {
		blockers.add("locally_bound_unresolved");
		return;
	}
	if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
		blockers.add("historical_paid_unresolved");
		return;
	}
	if (session.status === "expired" && session.expires_at * 1_000 <= nowMs) {
		evidence.add("expired_unpaid_provider_verified");
		return;
	}
	blockers.add("open_or_unknown_unpaid");
}

function validPage(page: Awaited<ReturnType<InventoryStripeClient["list"]>>) {
	if (
		!Array.isArray(page.data) ||
		typeof page.has_more !== "boolean" ||
		page.data.length > PAGE_SIZE
	) {
		return false;
	}
	for (let index = 1; index < page.data.length; index += 1) {
		const previous = page.data[index - 1];
		const current = page.data[index];
		if (!previous || !current || previous.created < current.created) return false;
	}
	return true;
}

function incomplete(scanClass: InventoryResult["scanClass"], blockers: string[]): InventoryResult {
	return {
		version: 1,
		outcome: "incomplete",
		scanClass,
		evidenceClasses: [],
		blockerClasses: [...new Set(blockers)].sort(),
	};
}
