/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { ORDER_REVENUE_NOT_READY, recordOrderRevenue } from "./helpers/orderRevenue";
const modules = import.meta.glob("./**/*.ts");
async function setup() {
	const t = convexTest(schema, modules);
	const email = "owner@fixture.example", siteUrl = "revenue.example";
	await t.mutation(internal.platform.seedClient, { siteUrl, name: "Revenue fixture", email, tier: "full", subscriptionStatus: "active", adminEmails: [email], role: "creator" });
	// Model a site that held orders before maintained totals existed.
	await t.run(async (ctx) => {
		const seeded = await ctx.db.query("orderRevenueBackfills").withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl)).unique();
		if (seeded) await ctx.db.delete(seeded._id);
	});
	const admin = t.withIdentity({ subject: email, email, emailVerified: true });
	async function order(total: number, currency?: string, live = false) {
		return t.run(async (ctx) => {
			const id = await ctx.db.insert("orders", { siteUrl, orderNumber: "fixture", stripeSessionId: crypto.randomUUID(), customerEmail: "fixture@example.com", total, stripePaymentCurrency: currency, items: [], status: "new", fulfillmentType: "digital" });
			if (live) { const row = await ctx.db.get(id); if (row) await recordOrderRevenue(ctx, row); }
			return id;
		});
	}
	return { t, admin, siteUrl, order };
}

test("backfill preserves mixed-currency totals, counts concurrent arrivals once, and leaves refunds as gross", async () => {
	const { t, admin, siteUrl, order } = await setup();
	await order(1234, "usd"); await order(900, "eur"); await order(300);
	await expect(admin.query(api.orders.getStats, { siteUrl })).rejects.toThrow(ORDER_REVENUE_NOT_READY);
	const args = { siteUrl, cursor: null, phase: "copy" as const };
	let state = await admin.mutation(api.orders.advanceDashboardBackfill, args);
	expect(state.phase).toBe("verify");
	expect(await admin.mutation(api.orders.advanceDashboardBackfill, args)).toEqual(state);
	const liveId = await order(200, "usd", true);
	await t.run(async (ctx) => { const row = await ctx.db.get(liveId); if (row) await recordOrderRevenue(ctx, row); });
	state = await admin.mutation(api.orders.advanceDashboardBackfill, { siteUrl, phase: "verify", cursor: null });
	expect(state.phase).toBe("compare");
	await order(100, "usd", true);
	state = await admin.mutation(api.orders.advanceDashboardBackfill, { siteUrl, phase: "compare", cursor: null });
	expect(state.phase).toBe("ready");
	await t.run(async (ctx) => { await ctx.db.patch(liveId, { status: "refunded" }); });
	const result = await admin.query(api.orders.getStats, { siteUrl });
	expect(result.grossPayments).toMatchObject([{ currency: "eur", allTimeMinorUnits: 900 }, { currency: "usd", allTimeMinorUnits: 1534 }]);
	expect(result.stats).toMatchObject({ totalOrders: 5, isTruncated: false, scanLimit: 0 });
	expect(result.unknownCurrencyOrderCount).toBe(1);
	await expect(t.mutation(api.orders.advanceDashboardBackfill, args)).rejects.toThrow();
});

test("a failed historical comparison cannot activate incomplete totals", async () => {
	const { t, admin, siteUrl, order } = await setup();
	await order(100, "usd");
	await admin.mutation(api.orders.advanceDashboardBackfill, { siteUrl, cursor: null, phase: "copy" });
	await admin.mutation(api.orders.advanceDashboardBackfill, { siteUrl, cursor: null, phase: "verify" });
	await t.run(async (ctx) => {
		const row = await ctx.db.query("orderRevenueTotals").withIndex("by_siteUrl_and_day_and_currency", (q) => q.eq("siteUrl", siteUrl).eq("day", "all")).first();
		if (row) await ctx.db.patch(row._id, { amount: "999" });
	});
	await expect(admin.mutation(api.orders.advanceDashboardBackfill, { siteUrl, cursor: null, phase: "compare" })).rejects.toThrow("comparison failed");
	await expect(admin.query(api.orders.getStats, { siteUrl })).rejects.toThrow(ORDER_REVENUE_NOT_READY);
});

test("pagination resumes across batches without counting a replay twice", async () => {
	const { admin, siteUrl, order } = await setup();
	for (let i = 0; i < 105; i++) await order(100, "usd");
	let state = await admin.mutation(api.orders.advanceDashboardBackfill, { siteUrl, cursor: null, phase: "copy" });
	expect(state.phase).toBe("copy");
	if (state.phase !== "copy") throw new Error("Expected a partial copy");
	const args = { siteUrl, cursor: state.cursor, phase: state.phase };
	state = await admin.mutation(api.orders.advanceDashboardBackfill, args);
	expect(await admin.mutation(api.orders.advanceDashboardBackfill, args)).toEqual(state);
	while (state.phase !== "ready") state = await admin.mutation(api.orders.advanceDashboardBackfill, { siteUrl, cursor: state.cursor, phase: state.phase });
	expect((await admin.query(api.orders.getStats, { siteUrl })).grossPayments[0]).toMatchObject({ orderCount: 105, allTimeMinorUnits: 10500 });
});

async function backfillPhase(t: Awaited<ReturnType<typeof setup>>["t"], siteUrl: string) {
	return await t.run(async (ctx) => (await ctx.db.query("orderRevenueBackfills").withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl)).unique())?.phase ?? null);
}

test("new sites start with ready empty totals and dashboards read them without scanning", async () => {
	const t = convexTest(schema, modules);
	const email = "creator@fixture.example", siteUrl = "new-site.example";
	await t.mutation(internal.platform.seedClient, { siteUrl: "hub.example", name: "Hub", email, tier: "full", subscriptionStatus: "active", adminEmails: [email], role: "creator" });
	const creator = t.withIdentity({ subject: email, email, emailVerified: true });
	await creator.mutation(api.platform.createClient, { siteUrl, name: "New", email, tier: "full", subscriptionStatus: "active", adminEmails: [email] });
	expect(await backfillPhase(t, siteUrl)).toBe("ready");
	expect(await backfillPhase(t, "hub.example")).toBe("ready");
	const empty = await creator.query(api.orders.getStatsForDay, { siteUrl, day: "2026-11-11" });
	expect(empty.stats).toMatchObject({ totalOrders: 0, allTimeRevenue: 0, isTruncated: false, scanLimit: 0 });
	expect(empty.grossPayments).toEqual([]);
	expect(empty.recentOrders).toEqual([]);
	await t.run(async (ctx) => {
		for (let i = 0; i < 12; i++) {
			const id = await ctx.db.insert("orders", { siteUrl, orderNumber: `NEW-${i}`, stripeSessionId: `cs_new_${i}`, customerEmail: "fixture@example.com", total: 100, stripePaymentCurrency: "usd", items: [], status: "new", fulfillmentType: "digital" });
			const row = await ctx.db.get(id);
			if (row) await recordOrderRevenue(ctx, row);
		}
	});
	const stats = await creator.query(api.orders.getStats, { siteUrl });
	expect(stats.stats).toMatchObject({ totalOrders: 12, allTimeRevenue: 1200, isTruncated: false, scanLimit: 0 });
	expect(stats.grossPayments).toMatchObject([{ currency: "usd", orderCount: 12, allTimeMinorUnits: 1200 }]);
	expect(stats.recentOrders).toHaveLength(10);
	expect(stats.recentOrders[0].orderNumber).toBe("NEW-11");
	await expect(t.query(api.orders.getStats, { siteUrl })).rejects.toThrow();
});

test("site creation and renames never activate totals for a site that already has orders", async () => {
	const t = convexTest(schema, modules);
	const email = "owner@fixture.example";
	await t.run(async (ctx) => {
		await ctx.db.insert("orders", { siteUrl: "legacy.example", orderNumber: "OLD-1", stripeSessionId: "cs_legacy", customerEmail: "fixture@example.com", total: 500, stripePaymentCurrency: "usd", items: [], status: "new", fulfillmentType: "digital" });
	});
	await t.mutation(internal.platform.seedClient, { siteUrl: "legacy.example", name: "Legacy", email, tier: "full", subscriptionStatus: "active", adminEmails: [email], role: "client" });
	expect(await backfillPhase(t, "legacy.example")).toBeNull();
	const admin = t.withIdentity({ subject: email, email, emailVerified: true });
	await expect(admin.query(api.orders.getStats, { siteUrl: "legacy.example" })).rejects.toThrow(ORDER_REVENUE_NOT_READY);
	await t.mutation(internal.platform.renameClientSiteUrl, { fromSiteUrl: "legacy.example", toSiteUrl: "renamed.example" });
	expect(await backfillPhase(t, "renamed.example")).toBe("ready");
	expect(await backfillPhase(t, "legacy.example")).toBeNull();
});

test("the empty-site migration seeds only sites without orders and is idempotent", async () => {
	const t = convexTest(schema, modules);
	await t.run(async (ctx) => {
		for (const siteUrl of ["empty.example", "with-orders.example", "ready.example", "copying.example"]) {
			await ctx.db.insert("platformClients", { siteUrl, name: siteUrl, email: `owner@${siteUrl}`, tier: "full", subscriptionStatus: "active", adminEmails: [`owner@${siteUrl}`], role: "client" });
		}
		await ctx.db.insert("orders", { siteUrl: "with-orders.example", orderNumber: "ORD-1", stripeSessionId: "cs_with_orders", customerEmail: "fixture@example.com", total: 100, stripePaymentCurrency: "usd", items: [], status: "new", fulfillmentType: "digital" });
		await ctx.db.insert("orderRevenueBackfills", { siteUrl: "ready.example", phase: "ready", cursor: null, copied: 3, verified: 3 });
		await ctx.db.insert("orderRevenueBackfills", { siteUrl: "copying.example", phase: "copy", cursor: "next", copied: 100, verified: 0 });
	});
	const outcomes = (result: { results: Array<{ siteUrl: string; outcome: string }> }) => Object.fromEntries(result.results.map(({ siteUrl, outcome }) => [siteUrl, outcome]));
	const dryRun = await t.mutation(internal.orders.seedEmptyDashboardTotals, { dryRun: true });
	expect(outcomes(dryRun)).toEqual({ "empty.example": "would_seed", "with-orders.example": "has_orders", "ready.example": "already_ready", "copying.example": "backfill_in_progress" });
	expect(await backfillPhase(t, "empty.example")).toBeNull();
	const first = await t.mutation(internal.orders.seedEmptyDashboardTotals, {});
	expect(first.isDone).toBe(true);
	expect(outcomes(first)).toEqual({ "empty.example": "seeded", "with-orders.example": "has_orders", "ready.example": "already_ready", "copying.example": "backfill_in_progress" });
	expect(await backfillPhase(t, "empty.example")).toBe("ready");
	expect(await backfillPhase(t, "with-orders.example")).toBeNull();
	expect(await backfillPhase(t, "copying.example")).toBe("copy");
	const again = await t.mutation(internal.orders.seedEmptyDashboardTotals, { cursor: null });
	expect(outcomes(again)["empty.example"]).toBe("already_ready");
	expect(await t.run((ctx) => ctx.db.query("orderRevenueBackfills").collect())).toHaveLength(3);
	const admin = t.withIdentity({ subject: "owner@empty.example", email: "owner@empty.example", emailVerified: true });
	expect((await admin.query(api.orders.getStats, { siteUrl: "empty.example" })).stats.totalOrders).toBe(0);
});
