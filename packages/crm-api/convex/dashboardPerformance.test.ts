/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");

async function setup() {
	const t = convexTest(schema, modules);
	const siteUrl = "performance.example";
	const email = "operator@performance.example";
	await t.mutation(internal.platform.seedClient, {
		siteUrl, email, name: "Performance fixture", tier: "full",
		subscriptionStatus: "active", adminEmails: [email], role: "client",
	});
	const admin = t.withIdentity({ subject: email, email, emailVerified: true });
	const clients = await Promise.all(["First", "Second"].map((name) => admin.mutation(api.crm.createClient, {
		siteUrl, name, email: `${name.toLowerCase()}@example.com`, category: "photography", type: "portrait",
	})));
	return { t, admin, siteUrl, clients };
}

test("a board reorder is atomic, ordered, and rejects foreign cards and invalid columns", async () => {
	const { t, admin, siteUrl, clients } = await setup();
	await admin.mutation(api.kanban.initializeBoard, { siteUrl, projectType: "portrait" });
	const [board] = await admin.query(api.kanban.listBoardConfigs, { siteUrl });
	const targetColumnId = board.columns[1].id;
	const args = { siteUrl, projectType: "portrait", targetColumnId, clientIds: [...clients].reverse() };
	await admin.mutation(api.kanban.reorderCards, args);
	const read = () => t.run(async (ctx) => Promise.all(clients.map((id) => ctx.db.get(id))));
	expect((await read()).map((card) => card?.boardPosition)).toEqual([1, 0]);
	await expect(admin.mutation(api.kanban.reorderCards, { ...args, targetColumnId: "missing" })).rejects.toThrow("Invalid target column");
	await expect(admin.mutation(api.kanban.reorderCards, { ...args, clientIds: [clients[0], clients[0]] })).rejects.toThrow("Invalid board order");
	await t.run(async (ctx) => { await ctx.db.patch(clients[1], { siteUrl: "foreign.example" }); });
	await expect(admin.mutation(api.kanban.reorderCards, { ...args, clientIds: clients })).rejects.toThrow("Not found");
	expect((await read())[0]?.boardPosition).toBe(1);
	await expect(t.mutation(api.kanban.reorderCards, args)).rejects.toThrow();
});

test("dashboard summary preserves invoice balances without sending line items", async () => {
	const { t, admin, siteUrl, clients } = await setup();
	const id = await admin.mutation(api.invoices.create, {
		siteUrl, clientId: clients[0], invoiceType: "one-time",
		items: [{ description: "Private line description", quantity: 2, unitPrice: 1000 }], taxPercent: 10,
	});
	await t.run(async (ctx) => { await ctx.db.patch(id, { status: "partial", paidAmount: 500 }); });
	const summary = await admin.query(api.invoices.getDashboardSummary, { siteUrl });
	expect(summary.pendingAmount).toBe(1700);
	expect(summary.recent).toHaveLength(1);
	expect(JSON.stringify(summary)).not.toContain("Private line description");
	expect(summary.isTruncated).toBe(false);
	await expect(t.query(api.invoices.getDashboardSummary, { siteUrl })).rejects.toThrow();
	await expect(admin.query(api.invoices.getDashboardSummary, { siteUrl: "foreign.example" })).rejects.toThrow();
});


test("order statistics stream the bounded history, preserve currencies, and flag truncation", async () => {
	const { t, admin, siteUrl } = await setup();
	for (let start = 0; start < 5001; start += 250) {
		if (start === 5000) {
			const exact = await admin.query(api.orders.getStats, { siteUrl });
			expect(exact.stats).toMatchObject({ totalOrders: 5000, isTruncated: false });
		}
		await t.run(async (ctx) => {
			for (let i = start; i < Math.min(start + 250, 5001); i++) {
				await ctx.db.insert("orders", { siteUrl, orderNumber: `ORDER-${i}`, stripeSessionId: `session-${i}`,
					customerEmail: "fixture@example.com", items: [], total: 100, stripePaymentCurrency: "usd",
					status: "new", fulfillmentType: "digital" });
			}
		});
	}
	const result = await admin.query(api.orders.getStats, { siteUrl });
	expect(result.stats).toMatchObject({ totalOrders: 5000, isTruncated: true, scanLimit: 5000 });
	expect(result.grossPayments).toMatchObject([{ currency: "usd", orderCount: 5000, allTimeMinorUnits: 500000 }]);
	expect(result.recentOrders).toHaveLength(10);
	expect(result.recentOrders[0].orderNumber).toBe("ORDER-5000");
	await expect(t.query(api.orders.getStats, { siteUrl })).rejects.toThrow();
});
