/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import type { PaginationResult } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const siteUrl = "crm-audit.example";
afterEach(() => vi.useRealTimers());
async function setup() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: "CRM",
		email: "admin@crm-audit.example",
		siteUrl,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: ["admin@crm-audit.example"],
		role: "client",
	});
	return {
		t,
		admin: t.withIdentity({
			subject: "admin",
			email: "admin@crm-audit.example",
			emailVerified: true,
		}),
	};
}
test.each([
	undefined,
	"photography",
] as const)("filters older matching clients before limiting (category %s)", async (category) => {
	const { t, admin } = await setup();
	vi.useFakeTimers();
	vi.setSystemTime(1000);
	const id = await t.run((ctx) =>
		ctx.db.insert("photographyClients", {
			siteUrl,
			name: "Booked",
			category: "photography",
			status: "booked",
		}),
	);
	vi.setSystemTime(2000);
	await t.run(async (ctx) => {
		for (let i = 0; i < 501; i++)
			await ctx.db.insert("photographyClients", {
				siteUrl,
				name: `Lead ${i}`,
				category: "photography",
				status: "lead",
			});
	});
	expect(
		(await admin.query(api.crm.listClients, { siteUrl, category, status: "booked" })).map(
			(row) => row._id,
		),
	).toEqual([id]);
});
test("pagination applies the same category/status filters across pages and tenants", async () => {
	const { t, admin } = await setup();
	await t.run(async (ctx) => {
		for (let i = 0; i < 5; i++)
			await ctx.db.insert("photographyClients", {
				siteUrl,
				name: `Match ${i}`,
				category: "web",
				status: "booked",
			});
		for (const [site, category, status] of [
			[siteUrl, "web", "lead"],
			[siteUrl, "photography", "booked"],
			["other.example", "web", "booked"],
		] as const)
			await ctx.db.insert("photographyClients", {
				siteUrl: site,
				name: "Exclude",
				category,
				status,
			});
	});
	const filters = { siteUrl, category: "web" as const, status: "booked" as const };
	const expected = await admin.query(api.crm.listClients, filters);
	const ids: string[] = [];
	let cursor: string | null = null;
	for (let i = 0; i < 4; i++) {
		const page: PaginationResult<Doc<"photographyClients">> = await admin.query(api.crm.listClientsPaginated, {
			...filters,
			paginationOpts: { numItems: 2, cursor },
		});
		ids.push(...page.page.map((row) => row._id));
		if (page.isDone) break;
		cursor = page.continueCursor;
	}
	expect(ids).toEqual(expected.map((row) => row._id));
	expect(ids).toHaveLength(5);
});
test.each([1000, 1001])("stats expose truncation for %i clients", async (count) => {
	const { t, admin } = await setup();
	await t.run(async (ctx) => {
		for (let i = 0; i < count; i++)
			await ctx.db.insert("photographyClients", {
				siteUrl,
				name: `Client ${i}`,
				category: "photography",
				status: "lead",
			});
	});
	expect(await admin.query(api.crm.getStats, { siteUrl })).toMatchObject({
		total: 1000,
		leads: 1000,
		photography: 1000,
		truncated: count > 1000,
	});
});
test("unfiltered and category-only lists retain bounded descending results", async () => {
	const { t, admin } = await setup();
	await t.run(async (ctx) => {
		for (let i = 0; i < 501; i++)
			await ctx.db.insert("photographyClients", {
				siteUrl,
				name: `Client ${i}`,
				category: "photography",
				status: "lead",
			});
	});
	for (const category of [undefined, "photography"] as const)
		expect(await admin.query(api.crm.listClients, { siteUrl, category })).toHaveLength(500);
	await expect(
		t.query(api.crm.listClientsPaginated, {
			siteUrl,
			paginationOpts: { numItems: 2, cursor: null },
		}),
	).rejects.toThrow("Not authenticated");
});

test("tagged pages stay bounded, retain filters and conceal foreign tags", async () => {
	const { t, admin } = await setup();
	const seeded = await t.run(async (ctx) => {
		const tagId = await ctx.db.insert("clientTags", { siteUrl, name: "local" });
		const foreignTag = await ctx.db.insert("clientTags", { siteUrl: "other.example", name: "foreign" });
		const ids = [];
		for (let i = 0; i < 55; i++) {
			const clientId = await ctx.db.insert("photographyClients", { siteUrl, name: `Client ${i}`, category: "web", status: "booked" });
			ids.push(clientId);
			for (const id of [tagId, foreignTag]) await ctx.db.insert("clientTagAssignments", { siteUrl, clientId, tagId: id });
		}
		return { ids, tagId };
	});
	const args = { siteUrl, category: "web" as const, status: "booked" as const };
	const first = await admin.query(api.crm.listClientsWithTags, { ...args, paginationOpts: { numItems: 500, cursor: null } });
	expect(first.page).toHaveLength(50);
	expect(first.isDone).toBe(false);
	const next = await admin.query(api.crm.listClientsWithTags, { ...args, paginationOpts: { numItems: 50, cursor: first.continueCursor } });
	expect(next.isDone).toBe(true);
	expect([...first.page, ...next.page].map(row => row._id)).toEqual([...seeded.ids].reverse());
	for (const row of [...first.page, ...next.page]) expect(row.tags.map(tag => tag._id)).toEqual([seeded.tagId]);
	expect((await admin.query(api.crm.listClientsWithTags, { ...args, status: "lead", paginationOpts: { numItems: 50, cursor: null } })).page).toEqual([]);
	await expect(t.query(api.crm.listClientsWithTags, { ...args, paginationOpts: { numItems: 50, cursor: null } })).rejects.toThrow();
	await expect(admin.query(api.crm.listClientsWithTags, { ...args, siteUrl: "other.example", paginationOpts: { numItems: 50, cursor: null } })).rejects.toThrow();
});
