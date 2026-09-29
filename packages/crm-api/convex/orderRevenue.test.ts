/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
import { recordOrderRevenue } from "./helpers/orderRevenue";
const modules = import.meta.glob("./**/*.ts");
async function setup() {
	const t = convexTest(schema, modules);
	const email = "owner@fixture.example", siteUrl = "revenue.example";
	await t.mutation(internal.platform.seedClient, { siteUrl, name: "Revenue fixture", email, tier: "full", subscriptionStatus: "active", adminEmails: [email], role: "creator" });
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
	const original = await admin.query(api.orders.getStats, { siteUrl });
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
	expect(result.unknownCurrencyOrderCount).toBe(original.unknownCurrencyOrderCount);
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
	expect((await admin.query(api.orders.getStats, { siteUrl })).stats.scanLimit).toBe(5000);
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
