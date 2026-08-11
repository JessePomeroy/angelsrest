import type Stripe from "stripe";

const PAGE_SIZE = 100;
const DEFAULT_MAX_PAGES = 10_000;
const SESSION_ID = /^cs_(?:test|live)_[A-Za-z0-9]{15,120}$/;
const ADMISSION_HASH = /^[0-9a-f]{64}$/;

export type InventorySession = Pick<
	Stripe.Checkout.Session,
	| "id"
	| "after_expiration"
	| "created"
	| "expires_at"
	| "livemode"
	| "metadata"
	| "mode"
	| "payment_link"
	| "payment_status"
	| "recovered_from"
	| "status"
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
	scanClass:
		| "complete"
		| "provider_error"
		| "scan_cap"
		| "pagination_invalid"
		| "head_shifted"
		| "history_shifted";
	evidenceClasses: string[];
	blockerClasses: string[];
}

interface InventoryScan extends InventoryResult {
	projection: string[];
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
	if (
		!validInputs({ cutoffCreatedSeconds, acceptUntilMs, nowMs, maxPages }) ||
		nowMs < acceptUntilMs
	)
		return incomplete("pagination_invalid", ["cutoff_or_horizon_invalid"]);
	const { projection: _projection, ...result } = await scanCheckoutSessions({
		stripe,
		routing,
		cutoffCreatedSeconds,
		nowMs,
		targetSite,
		knownSites,
		maxPages,
	});
	return result;
}

/**
 * Immediate read-only alternative to the elapsed-horizon proof. Two complete
 * provider scans, including routing state, must produce one identical fixed
 * point. Any still-payable, processing, unresolved, or shifting Session blocks.
 */
export async function inventoryCheckoutSessionsAtFixedPoint({
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
	if (!validInputs({ cutoffCreatedSeconds, acceptUntilMs, nowMs, maxPages })) {
		return incomplete("pagination_invalid", ["cutoff_or_horizon_invalid"]);
	}
	const input = {
		stripe,
		routing,
		cutoffCreatedSeconds,
		nowMs,
		targetSite,
		knownSites,
		maxPages,
	};
	const first = await scanCheckoutSessions(input);
	if (first.scanClass !== "complete") return publicResult(first);
	const second = await scanCheckoutSessions(input);
	if (second.scanClass !== "complete") return publicResult(second);
	if (
		first.projection.length !== second.projection.length ||
		first.projection.some((entry, index) => entry !== second.projection[index])
	) {
		return incomplete("history_shifted", ["history_shifted"]);
	}
	return {
		version: 1,
		outcome: second.outcome,
		scanClass: "complete",
		evidenceClasses: [...new Set([...second.evidenceClasses, "full_history_fixed_point"])].sort(),
		blockerClasses: second.blockerClasses,
	};
}

async function scanCheckoutSessions({
	stripe,
	routing,
	cutoffCreatedSeconds,
	nowMs,
	targetSite,
	knownSites,
	maxPages,
}: {
	stripe: InventoryStripeClient;
	routing: InventoryRoutingClient;
	cutoffCreatedSeconds: number;
	nowMs: number;
	targetSite: string;
	knownSites: readonly string[];
	maxPages: number;
}): Promise<InventoryScan> {
	const blockers = new Set<string>();
	const evidence = new Set<string>();
	const seen = new Set<string>();
	const projection: string[] = [];
	let firstPage: Awaited<ReturnType<InventoryStripeClient["list"]>>;
	try {
		firstPage = await stripe.list({ limit: PAGE_SIZE });
	} catch {
		return scanIncomplete("provider_error", ["provider_error"]);
	}
	const anchorHead = firstPage.data[0]?.id ?? null;
	let page = firstPage;
	let pages = 0;

	while (true) {
		pages += 1;
		if (pages > maxPages) return scanIncomplete("scan_cap", ["scan_cap"]);
		if (!validPage(page)) return scanIncomplete("pagination_invalid", ["pagination_invalid"]);

		for (const session of page.data) {
			if (seen.has(session.id)) {
				return scanIncomplete("pagination_invalid", ["pagination_duplicate"]);
			}
			seen.add(session.id);
			const classification = await classifySession({
				session,
				routing,
				cutoffCreatedSeconds,
				nowMs,
				targetSite,
				knownSites,
				blockers,
				evidence,
			});
			projection.push(providerProjection(session, classification));
		}

		if (!page.has_more) break;
		const cursor = page.data.at(-1)?.id;
		if (!cursor) return scanIncomplete("pagination_invalid", ["pagination_empty_more"]);
		try {
			page = await stripe.list({ limit: PAGE_SIZE, starting_after: cursor });
		} catch {
			return scanIncomplete("provider_error", ["provider_error"]);
		}
	}

	let reread: Awaited<ReturnType<InventoryStripeClient["list"]>>;
	try {
		reread = await stripe.list({ limit: PAGE_SIZE });
	} catch {
		return scanIncomplete("provider_error", ["head_reread_error"]);
	}
	if (!validPage(reread) || (reread.data[0]?.id ?? null) !== anchorHead) {
		return scanIncomplete("head_shifted", ["head_shifted"]);
	}

	evidence.add("full_history_paginated");
	evidence.add("head_reread_stable");
	return {
		version: 1,
		outcome: blockers.size === 0 ? "clear" : "incomplete",
		scanClass: "complete",
		evidenceClasses: [...evidence].sort(),
		blockerClasses: [...blockers].sort(),
		projection,
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
}): Promise<string> {
	if (
		!SESSION_ID.test(session.id) ||
		session.livemode !== true ||
		!Number.isSafeInteger(session.created) ||
		session.created < 0 ||
		!Number.isSafeInteger(session.expires_at) ||
		session.expires_at < session.created
	) {
		blockers.add("provider_projection_invalid");
		return "provider_projection_invalid";
	}
	const metadata = session.metadata ?? {};
	if (metadata.type === "invoice_payment" || metadata.type === "platform_subscription") {
		evidence.add("retained_non_order_checkout_observed");
		return `retained:${metadata.type}`;
	}
	if (metadata.type !== undefined) {
		blockers.add("unknown_legacy_purpose");
		return "unknown_legacy_purpose";
	}
	const marker = metadata.commerceTenantSiteUrl;
	if (marker && marker !== targetSite) {
		if (!knownSites.includes(marker)) blockers.add("unknown_tenant_marker");
		else evidence.add("other_known_tenant_excluded");
		return knownSites.includes(marker) ? "other_known_tenant" : "unknown_tenant_marker";
	}
	if (
		session.mode !== "payment" ||
		!(["paid", "unpaid", "no_payment_required"] as const).includes(session.payment_status) ||
		!(["open", "complete", "expired", null] as const).includes(session.status)
	) {
		blockers.add("provider_projection_invalid");
		return "provider_projection_invalid";
	}
	const legacyOrderShape =
		metadata.productId !== undefined ||
		metadata.isCart === "true" ||
		Object.keys(metadata).some(
			(key) => key.startsWith("checkoutSnapshot") || key.startsWith("checkoutAdmission"),
		);
	if (marker !== targetSite && !legacyOrderShape) {
		blockers.add("unknown_legacy_purpose");
		return "unknown_legacy_purpose";
	}
	if (session.payment_link !== null) {
		blockers.add("payment_link_order_source");
	}
	const recovery = session.after_expiration?.recovery;
	if (
		recovery?.enabled === true &&
		(recovery.expires_at === null ||
			!Number.isSafeInteger(recovery.expires_at) ||
			recovery.expires_at * 1_000 > nowMs)
	) {
		blockers.add("recovery_url_active");
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
		return "routing_error";
	}
	if (route === "order" || route === "retired") {
		evidence.add(route === "order" ? "stored_order_resolved" : "retired_order_resolved");
		return route;
	}
	if (route === "reservation" || route === "admission") {
		evidence.add(`locally_bound_route_${route}`);
		evidence.add(`locally_bound_payment_${session.payment_status}`);
		evidence.add(`locally_bound_status_${session.status ?? "unknown"}`);
		evidence.add(`locally_bound_age_${preCutoffAgeClass(session.created, cutoffCreatedSeconds)}`);
		blockers.add("locally_bound_unresolved");
		return route;
	}
	if (session.payment_status === "paid" || session.payment_status === "no_payment_required") {
		evidence.add(
			session.created < cutoffCreatedSeconds
				? "historical_paid_created_before_cutoff"
				: "historical_paid_created_at_or_after_cutoff",
		);
		if (session.created < cutoffCreatedSeconds) {
			evidence.add(
				`historical_paid_age_${preCutoffAgeClass(session.created, cutoffCreatedSeconds)}`,
			);
		}
		evidence.add(admissionMarked ? "historical_paid_admission_marked" : "historical_paid_legacy");
		blockers.add("historical_paid_unresolved");
		return "historical_paid_unresolved";
	}
	if (session.status === "expired" && session.expires_at * 1_000 <= nowMs) {
		evidence.add("expired_unpaid_provider_verified");
		return "expired_unpaid";
	}
	blockers.add("open_or_unknown_unpaid");
	return "open_or_unknown_unpaid";
}

function preCutoffAgeClass(created: number, cutoff: number) {
	if (created >= cutoff) return "at_or_after_cutoff";
	const ageSeconds = cutoff - created;
	if (ageSeconds <= 24 * 60 * 60) return "within_24h_pre_cutoff";
	if (ageSeconds <= 7 * 24 * 60 * 60) return "1d_to_7d_pre_cutoff";
	if (ageSeconds <= 37 * 24 * 60 * 60) return "7d_to_37d_pre_cutoff";
	return "older_than_37d_pre_cutoff";
}

function providerProjection(session: InventorySession, classification: string) {
	return JSON.stringify([
		session.id,
		session.after_expiration,
		session.created,
		session.expires_at,
		session.livemode,
		session.mode,
		session.payment_link,
		session.payment_status,
		session.recovered_from,
		session.status,
		Object.entries(session.metadata ?? {}).sort(([left], [right]) => left.localeCompare(right)),
		classification,
	]);
}

function validInputs({
	cutoffCreatedSeconds,
	acceptUntilMs,
	nowMs,
	maxPages,
}: {
	cutoffCreatedSeconds: number;
	acceptUntilMs: number;
	nowMs: number;
	maxPages: number;
}) {
	const cutoffMs = cutoffCreatedSeconds * 1_000;
	return (
		Number.isSafeInteger(cutoffCreatedSeconds) &&
		cutoffCreatedSeconds >= 0 &&
		Number.isSafeInteger(cutoffMs) &&
		Number.isSafeInteger(acceptUntilMs) &&
		acceptUntilMs === cutoffMs + 3_222_000_000 &&
		Number.isSafeInteger(nowMs) &&
		nowMs >= 0 &&
		Number.isSafeInteger(maxPages) &&
		maxPages >= 1
	);
}

function publicResult({ projection: _projection, ...result }: InventoryScan): InventoryResult {
	return result;
}

function scanIncomplete(
	scanClass: InventoryResult["scanClass"],
	blockers: string[],
): InventoryScan {
	return { ...incomplete(scanClass, blockers), projection: [] };
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
