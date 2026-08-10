import { describe, expect, it, vi } from "vitest";
import {
	type InventoryRoute,
	type InventorySession,
	inventoryCheckoutSessions,
} from "./r4-checkout-session-inventory-core";

const cutoff = 1_700_000_000;
const acceptUntil = cutoff * 1_000 + 3_222_000_000;
const now = acceptUntil + 1;

function session(overrides: Partial<InventorySession> = {}): InventorySession {
	return {
		id: "cs_live_1234567890abcdef",
		created: cutoff - 100,
		expires_at: cutoff - 10,
		livemode: true,
		metadata: { commerceTenantSiteUrl: "angelsrest.online", productId: "product" },
		mode: "payment",
		payment_status: "unpaid",
		status: "expired",
		...overrides,
	};
}

function adapters({
	pages,
	routes = new Map<string, InventoryRoute>(),
}: {
	pages: InventorySession[][];
	routes?: Map<string, InventoryRoute>;
}) {
	let pageIndex = 0;
	const list = vi.fn(async ({ starting_after }: { limit: number; starting_after?: string }) => {
		if (!starting_after && pageIndex >= pages.length)
			return { data: pages[0] ?? [], has_more: false };
		const data = pages[pageIndex] ?? [];
		pageIndex += 1;
		return { data, has_more: pageIndex < pages.length };
	});
	return {
		stripe: { list },
		routing: {
			resolve: vi.fn(async (candidate: InventorySession) => routes.get(candidate.id) ?? null),
		},
	};
}

describe("R4 complete-history Checkout Session inventory", () => {
	it("accepts a complete stable history with resolved and expired-unpaid sessions", async () => {
		const stored = session({ id: "cs_live_1234567890abcdea", payment_status: "paid" });
		const expired = session({ id: "cs_live_1234567890abcdeb", created: cutoff - 200 });
		const a = adapters({ pages: [[stored, expired]], routes: new Map([[stored.id, "order"]]) });
		expect(
			await inventoryCheckoutSessions({
				...a,
				cutoffCreatedSeconds: cutoff,
				acceptUntilMs: acceptUntil,
				nowMs: now,
			}),
		).toEqual({
			version: 1,
			outcome: "clear",
			scanClass: "complete",
			evidenceClasses: [
				"expired_unpaid_provider_verified",
				"full_history_paginated",
				"head_reread_stable",
				"stored_order_resolved",
			],
			blockerClasses: [],
		});
	});

	it("paginates to has_more false and blocks duplicate or shifted histories", async () => {
		const first = session({ id: "cs_live_1234567890abcdea" });
		const second = session({ id: "cs_live_1234567890abcdeb", created: cutoff - 200 });
		const a = adapters({ pages: [[first], [second]] });
		const result = await inventoryCheckoutSessions({
			...a,
			cutoffCreatedSeconds: cutoff,
			acceptUntilMs: acceptUntil,
			nowMs: now,
		});
		expect(result.outcome).toBe("clear");
		expect(a.stripe.list).toHaveBeenNthCalledWith(2, { limit: 100, starting_after: first.id });

		let calls = 0;
		const shifted = {
			stripe: {
				list: vi.fn(async () => ({ data: [calls++ === 0 ? first : second], has_more: false })),
			},
			routing: { resolve: vi.fn(async () => null) },
		};
		expect(
			await inventoryCheckoutSessions({
				...shifted,
				cutoffCreatedSeconds: cutoff,
				acceptUntilMs: acceptUntil,
				nowMs: now,
			}),
		).toMatchObject({
			outcome: "incomplete",
			scanClass: "head_shifted",
			blockerClasses: ["head_shifted"],
		});
	});

	it("blocks paid unresolved, bound unresolved, unknown purpose, and post-cutoff unmarked sessions", async () => {
		const paid = session({ id: "cs_live_1234567890abcdea", payment_status: "paid" });
		const bound = session({ id: "cs_live_1234567890abcdeb", created: cutoff - 200 });
		const unknown = session({
			id: "cs_live_1234567890abcdec",
			created: cutoff - 300,
			metadata: {},
		});
		const postCutoff = session({
			id: "cs_live_1234567890abcded",
			created: cutoff + 1,
			expires_at: cutoff + 3601,
		});
		const a = adapters({
			pages: [[postCutoff, paid, bound, unknown]],
			routes: new Map([[bound.id, "reservation"]]),
		});
		const result = await inventoryCheckoutSessions({
			...a,
			cutoffCreatedSeconds: cutoff,
			acceptUntilMs: acceptUntil,
			nowMs: now,
		});
		expect(result).toMatchObject({
			outcome: "incomplete",
			blockerClasses: [
				"historical_paid_unresolved",
				"locally_bound_unresolved",
				"post_cutoff_missing_admission",
				"unknown_legacy_purpose",
			],
		});
	});

	it("excludes retained invoice/subscription and other known tenant sessions", async () => {
		const invoice = session({
			id: "cs_live_1234567890abcdea",
			metadata: { type: "invoice_payment" },
		});
		const subscription = session({
			id: "cs_live_1234567890abcdeb",
			mode: "subscription",
			metadata: { type: "platform_subscription" },
		});
		const spoke = session({
			id: "cs_live_1234567890abcdec",
			metadata: { commerceTenantSiteUrl: "zippymiggy.com" },
		});
		const a = adapters({ pages: [[invoice, subscription, spoke]] });
		const result = await inventoryCheckoutSessions({
			...a,
			cutoffCreatedSeconds: cutoff,
			acceptUntilMs: acceptUntil,
			nowMs: now,
		});
		expect(result.outcome).toBe("clear");
		expect(result.evidenceClasses).toContain("retained_non_order_checkout_observed");
		expect(result.evidenceClasses).toContain("other_known_tenant_excluded");
		expect(a.routing.resolve).not.toHaveBeenCalled();
	});

	it("fails closed on early invocation, provider errors, scan caps, and pagination duplicates", async () => {
		const a = adapters({ pages: [[]] });
		expect(
			await inventoryCheckoutSessions({
				...a,
				cutoffCreatedSeconds: cutoff,
				acceptUntilMs: acceptUntil,
				nowMs: acceptUntil - 1,
			}),
		).toMatchObject({
			outcome: "incomplete",
			blockerClasses: ["cutoff_or_horizon_invalid"],
		});
		const providerError = {
			stripe: {
				list: vi.fn(async () => {
					throw new Error("raw secret-bearing error");
				}),
			},
			routing: { resolve: vi.fn() },
		};
		expect(
			await inventoryCheckoutSessions({
				...providerError,
				cutoffCreatedSeconds: cutoff,
				acceptUntilMs: acceptUntil,
				nowMs: now,
			}),
		).toEqual({
			version: 1,
			outcome: "incomplete",
			scanClass: "provider_error",
			evidenceClasses: [],
			blockerClasses: ["provider_error"],
		});
		const first = session({ id: "cs_live_1234567890abcdea" });
		const second = session({ id: "cs_live_1234567890abcdeb", created: cutoff - 200 });
		const capped = adapters({ pages: [[first], [second]] });
		expect(
			await inventoryCheckoutSessions({
				...capped,
				cutoffCreatedSeconds: cutoff,
				acceptUntilMs: acceptUntil,
				nowMs: now,
				maxPages: 1,
			}),
		).toMatchObject({
			scanClass: "scan_cap",
			blockerClasses: ["scan_cap"],
		});
		const duplicate = adapters({ pages: [[first], [first]] });
		expect(
			await inventoryCheckoutSessions({
				...duplicate,
				cutoffCreatedSeconds: cutoff,
				acceptUntilMs: acceptUntil,
				nowMs: now,
			}),
		).toMatchObject({
			scanClass: "pagination_invalid",
			blockerClasses: ["pagination_duplicate"],
		});
	});

	it("rejects non-live, non-payment, unknown-purpose, and unsafe-horizon projections", async () => {
		for (const candidate of [
			session({ livemode: false }),
			session({ mode: "setup" }),
			session({ payment_status: "unpaid", status: null }),
		]) {
			const a = adapters({ pages: [[candidate]] });
			const result = await inventoryCheckoutSessions({
				...a,
				cutoffCreatedSeconds: cutoff,
				acceptUntilMs: acceptUntil,
				nowMs: now,
			});
			if (candidate.status === null && candidate.livemode && candidate.mode === "payment") {
				expect(result.blockerClasses).toEqual(["open_or_unknown_unpaid"]);
			} else {
				expect(result.blockerClasses).toEqual(["provider_projection_invalid"]);
			}
		}

		const unknownPurpose = adapters({
			pages: [
				[
					session({
						metadata: {
							commerceTenantSiteUrl: "angelsrest.online",
							type: "future_checkout_purpose",
						},
					}),
				],
			],
		});
		expect(
			await inventoryCheckoutSessions({
				...unknownPurpose,
				cutoffCreatedSeconds: cutoff,
				acceptUntilMs: acceptUntil,
				nowMs: now,
			}),
		).toMatchObject({ blockerClasses: ["unknown_legacy_purpose"] });

		const unsafeCutoff = Number.MAX_SAFE_INTEGER;
		const a = adapters({ pages: [[]] });
		expect(
			await inventoryCheckoutSessions({
				...a,
				cutoffCreatedSeconds: unsafeCutoff,
				acceptUntilMs: unsafeCutoff,
				nowMs: unsafeCutoff,
			}),
		).toMatchObject({ blockerClasses: ["cutoff_or_horizon_invalid"] });
	});
});
