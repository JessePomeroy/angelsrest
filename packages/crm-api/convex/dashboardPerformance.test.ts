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
	expect(summary.counts).toEqual({ draft: 0, sent: 0, paid: 0, overdue: 0, partial: 1 });
	expect(summary.recent).toHaveLength(1);
	expect(JSON.stringify(summary)).not.toContain("Private line description");
	expect(summary.isTruncated).toBe(false);
	await expect(t.query(api.invoices.getDashboardSummary, { siteUrl })).rejects.toThrow();
	await expect(admin.query(api.invoices.getDashboardSummary, { siteUrl: "foreign.example" })).rejects.toThrow();
});


test("invoice summary counts the same outstanding statuses as its balance", async () => {
	const { t, admin, siteUrl, clients } = await setup();
	await t.run(async (ctx) => {
		for (const status of ["draft", "sent", "overdue", "partial", "paid", "canceled"] as const) {
			await ctx.db.insert("invoices", {
				siteUrl, clientId: clients[0], invoiceType: "one-time", invoiceNumber: `INV-${status}`,
				status, items: [{ description: "Private item", quantity: 1, unitPrice: 1000 }],
				...(status === "partial" ? { paidAmount: 400 } : {}),
			});
		}
		await ctx.db.insert("invoices", {
			siteUrl: "foreign.example", clientId: clients[1], invoiceType: "one-time", invoiceNumber: "FOREIGN",
			status: "partial", items: [{ description: "Foreign item", quantity: 1, unitPrice: 9000 }], paidAmount: 100,
		});
	});
	const summary = await admin.query(api.invoices.getDashboardSummary, { siteUrl });
	expect(summary.counts).toEqual({ draft: 1, sent: 1, paid: 1, overdue: 1, partial: 1 });
	expect(summary.pendingAmount).toBe(3600);
	expect(summary.isTruncated).toBe(false);
	expect(summary.recent).toHaveLength(5);
	expect(JSON.stringify(summary)).not.toContain("Foreign item");
});

test("invoice summary retains the 200-document boundary and partial count", async () => {
	const { t, admin, siteUrl, clients } = await setup();
	await t.run(async (ctx) => {
		for (let i = 0; i < 201; i++) {
			await ctx.db.insert("invoices", {
				siteUrl, clientId: clients[0], invoiceType: "one-time", invoiceNumber: `INV-${i}`,
				status: "partial", items: [{ description: "Private item", quantity: 1, unitPrice: 100 }], paidAmount: 20,
			});
		}
	});
	const summary = await admin.query(api.invoices.getDashboardSummary, { siteUrl });
	expect(summary.counts).toEqual({ draft: 0, sent: 0, paid: 0, overdue: 0, partial: 200 });
	expect(summary.pendingAmount).toBe(16000);
	expect(summary.isTruncated).toBe(true);
	expect(summary.recent).toHaveLength(5);
	expect(JSON.stringify(summary)).not.toContain("Private item");
});

test("unknown partial payments keep the count but make the amount unavailable", async () => {
	const { t, admin, siteUrl, clients } = await setup();
	await t.run(async (ctx) => {
		await ctx.db.insert("invoices", {
			siteUrl, clientId: clients[0], invoiceType: "one-time", invoiceNumber: "INV-unknown",
			status: "partial", items: [{ description: "Private item", quantity: 1, unitPrice: 1000 }],
		});
	});
	const summary = await admin.query(api.invoices.getDashboardSummary, { siteUrl });
	expect(summary.counts).toEqual({ draft: 0, sent: 0, paid: 0, overdue: 0, partial: 1 });
	expect(summary.pendingAmount).toBeNull();
});
