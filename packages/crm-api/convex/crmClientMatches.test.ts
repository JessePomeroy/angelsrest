/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import type { FunctionReturnType, PaginationOptions } from "convex/server";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const siteUrl = "client-filter.example.invalid";
const identity = {
	subject: "client-filter-owner",
	tokenIdentifier: "https://identity.example.invalid|client-filter-owner",
	email: "owner@client-filter.example.invalid",
	emailVerified: true,
};
const client = { siteUrl, name: "Avery Stone", category: "web", status: "booked" } satisfies Omit<
	Doc<"photographyClients">,
	"_id" | "_creationTime"
>;
afterEach(() => vi.useRealTimers());

async function setup(tier: "full" | "basic" = "full") {
	const t = convexTest(schema, modules);
	const tenant = await t.mutation(internal.platform.seedClient, {
		name: "Fictional client filter site",
		siteUrl,
		email: identity.email,
		adminEmails: [identity.email],
		tier,
		subscriptionStatus: "active",
		role: "client",
	});
	await t.run((ctx) => ctx.db.patch(tenant.id, { adminIdentityIds: [identity.tokenIdentifier] }));
	return { t, admin: t.withIdentity(identity) };
}

test.each([
	"y st",
	"+gallery@EXAMPLE",
])("continues through two empty batches to an older literal match (%s)", async (search) => {
	const { t, admin } = await setup();
	vi.useFakeTimers();
	vi.setSystemTime(1000);
	const older = await t.run((ctx) =>
		ctx.db.insert("photographyClients", { ...client, email: "Owner+Gallery@Example.invalid" }),
	);
	vi.setSystemTime(2000);
	await t.run(async (ctx) => {
		for (let i = 0; i < 120; i++)
			await ctx.db.insert("photographyClients", { ...client, name: `Unrelated ${i}` });
	});
	// Installed consumers still receive the same first 50 candidates.
	const legacy = await admin.query(api.crm.listClientsWithTags, {
		siteUrl,
		paginationOpts: { cursor: null, numItems: 50 },
	});
	expect(legacy.page).toHaveLength(50);
	expect(legacy.page.some((row) => row._id === older)).toBe(false);
	let cursor: string | null = null;
	const found: string[] = [];
	for (let batch = 0; batch < 3; batch++) {
		const result: FunctionReturnType<typeof api.crm.scanClientsWithTags> = await admin.query(
			api.crm.scanClientsWithTags,
			{ siteUrl, search, paginationOpts: { cursor, numItems: 50 } },
		);
		expect(result.scannedCount).toBe(batch < 2 ? 50 : 21);
		expect(result.isDone).toBe(batch === 2);
		if (batch < 2) expect(result.page).toEqual([]);
		found.push(...result.page.map((row) => row._id));
		cursor = result.continueCursor;
	}
	expect(found).toEqual([older]);
});

test("keeps substring whitespace significant and does not substitute token-prefix matching", async () => {
	const { t, admin } = await setup();
	await t.run((ctx) => ctx.db.insert("photographyClients", client));
	for (const [search, expected] of [
		["ry Sto", 1],
		["Stone ", 0],
		[" ", 1],
		["", 1],
	] as const) {
		const result = await admin.query(api.crm.scanClientsWithTags, {
			siteUrl,
			search,
			paginationOpts: { cursor: null, numItems: 50 },
		});
		expect(result.page).toHaveLength(expected);
		expect(result.isDone).toBe(true);
	}
});

test("applies category/status indexes before the candidate budget and excludes foreign clients", async () => {
	const { t, admin } = await setup();
	vi.useFakeTimers();
	vi.setSystemTime(1000);
	const id = await t.run((ctx) => ctx.db.insert("photographyClients", client));
	vi.setSystemTime(2000);
	await t.run(async (ctx) => {
		for (let i = 0; i < 80; i++) {
			await ctx.db.insert("photographyClients", { ...client, category: "photography" });
			await ctx.db.insert("photographyClients", { ...client, status: "lead" });
			await ctx.db.insert("photographyClients", { ...client, siteUrl: "foreign.example.invalid" });
		}
	});
	const result = await admin.query(api.crm.scanClientsWithTags, {
		siteUrl,
		category: "web",
		status: "booked",
		search: "avery",
		paginationOpts: { cursor: null, numItems: 50 },
	});
	expect(result.page.map((row) => row._id)).toEqual([id]);
	expect(result.scannedCount).toBe(1);
	expect(result.isDone).toBe(true);
});

test("matches an older selected tag beyond the bounded displayed tag projection", async () => {
	const { t, admin } = await setup();
	vi.useFakeTimers();
	vi.setSystemTime(1000);
	const seeded = await t.run(async (ctx) => {
		const clientId = await ctx.db.insert("photographyClients", client);
		for (let i = 0; i < 50; i++) {
			const tagId = await ctx.db.insert("clientTags", { siteUrl, name: `Earlier tag ${i}` });
			await ctx.db.insert("clientTagAssignments", { siteUrl, clientId, tagId });
		}
		const tagId = await ctx.db.insert("clientTags", { siteUrl, name: "Selected tag" });
		await ctx.db.insert("clientTagAssignments", { siteUrl, clientId, tagId });
		return { clientId, tagId };
	});
	vi.setSystemTime(2000);
	await t.run(async (ctx) => {
		for (let i = 0; i < 55; i++)
			await ctx.db.insert("photographyClients", { ...client, name: `Other ${i}` });
	});
	const first = await admin.query(api.crm.scanClientsWithTags, {
		siteUrl,
		tagId: seeded.tagId,
		search: "STONE",
		paginationOpts: { cursor: null, numItems: 50 },
	});
	expect(first).toMatchObject({ page: [], isDone: false, scannedCount: 50 });
	const next = await admin.query(api.crm.scanClientsWithTags, {
		siteUrl,
		tagId: seeded.tagId,
		search: "STONE",
		paginationOpts: { cursor: first.continueCursor, numItems: 50 },
	});
	expect(next.page.map((row) => row._id)).toEqual([seeded.clientId]);
	expect(next.page[0].tags).toHaveLength(50);
	expect(next).toMatchObject({ isDone: true, scannedCount: 6 });
});

test("rejects missing/foreign selected tags and conceals malformed assignments", async () => {
	const { t, admin } = await setup();
	const seeded = await t.run(async (ctx) => {
		const tagId = await ctx.db.insert("clientTags", { siteUrl, name: "Local tag" });
		const foreignTag = await ctx.db.insert("clientTags", {
			siteUrl: "foreign.example.invalid",
			name: "Foreign tag",
		});
		const missingTag = await ctx.db.insert("clientTags", { siteUrl, name: "Deleted tag" });
		await ctx.db.delete(missingTag);
		const clientId = await ctx.db.insert("photographyClients", client);
		await ctx.db.insert("clientTagAssignments", {
			siteUrl: "foreign.example.invalid",
			clientId,
			tagId,
		});
		const foreignClient = await ctx.db.insert("photographyClients", {
			...client,
			siteUrl: "foreign.example.invalid",
		});
		await ctx.db.insert("clientTagAssignments", { siteUrl, clientId: foreignClient, tagId });
		await ctx.db.insert("clientTagAssignments", { siteUrl, clientId, tagId: foreignTag });
		return { tagId, foreignTag, missingTag };
	});
	for (const tagId of [seeded.foreignTag, seeded.missingTag])
		await expect(
			admin.query(api.crm.scanClientsWithTags, {
				siteUrl,
				tagId,
				paginationOpts: { cursor: null, numItems: 50 },
			}),
		).rejects.toThrow("Not found");
	const result = await admin.query(api.crm.scanClientsWithTags, {
		siteUrl,
		tagId: seeded.tagId,
		paginationOpts: { cursor: null, numItems: 50 },
	});
	expect(result).toMatchObject({ page: [], isDone: true, scannedCount: 1 });
});

test("requires stored membership, claimed identity and CRM capability", async () => {
	const { t, admin } = await setup();
	const args = { siteUrl, paginationOpts: { cursor: null, numItems: 50 } };
	await expect(t.query(api.crm.scanClientsWithTags, args)).rejects.toThrow("Not authenticated");
	for (const outsider of [
		{
			...identity,
			email: "outsider@example.invalid",
			tokenIdentifier: "https://identity.example.invalid|outsider",
		},
		{
			...identity,
			subject: "other-owner",
			tokenIdentifier: "https://identity.example.invalid|other-owner",
		},
	])
		await expect(t.withIdentity(outsider).query(api.crm.scanClientsWithTags, args)).rejects.toThrow(
			"Not authorized",
		);
	await expect(
		admin.query(api.crm.scanClientsWithTags, { ...args, siteUrl: "foreign.example.invalid" }),
	).rejects.toThrow("Not authorized");
	const basic = await setup("basic");
	await expect(basic.admin.query(api.crm.scanClientsWithTags, args)).rejects.toThrow();
});

test.each([0, -1, 1.5, 51])("rejects invalid candidate batch size %s", async (numItems) => {
	const { admin } = await setup();
	await expect(
		admin.query(api.crm.scanClientsWithTags, {
			siteUrl,
			paginationOpts: { cursor: null, numItems },
		}),
	).rejects.toThrow("1 to 50");
});

test("bounds search input and accepts the boundary", async () => {
	const { admin } = await setup();
	await expect(
		admin.query(api.crm.scanClientsWithTags, {
			siteUrl,
			search: "x".repeat(201),
			paginationOpts: { cursor: null, numItems: 50 },
		}),
	).rejects.toThrow("200");
	expect(
		(
			await admin.query(api.crm.scanClientsWithTags, {
				siteUrl,
				search: "x".repeat(200),
				paginationOpts: { cursor: null, numItems: 50 },
			})
		).isDone,
	).toBe(true);
});

test("retains native order/continuation without duplicates for short batches", async () => {
	const { t, admin } = await setup();
	await t.run(async (ctx) => {
		for (let i = 0; i < 9; i++)
			await ctx.db.insert("photographyClients", {
				...client,
				name: i % 2 ? `Hit ${i}` : `Other ${i}`,
			});
	});
	const expected = (await admin.query(api.crm.listClients, { siteUrl }))
		.filter((row) => row.name.includes("Hit"))
		.map((row) => row._id);
	const ids: string[] = [];
	let cursor: string | null = null;
	for (let batch = 0; batch < 5; batch++) {
		const result: FunctionReturnType<typeof api.crm.scanClientsWithTags> = await admin.query(
			api.crm.scanClientsWithTags,
			{ siteUrl, search: "hit", paginationOpts: { cursor, numItems: 2 } },
		);
		expect(result.scannedCount).toBeLessThanOrEqual(2);
		ids.push(...result.page.map((row) => row._id));
		if (result.isDone) break;
		cursor = result.continueCursor;
	}
	expect(ids).toEqual(expected);
	expect(new Set(ids).size).toBe(ids.length);
});

test("overrides expanded caller budgets and retains split metadata on an empty match batch", async () => {
	const { t, admin } = await setup();
	await t.run(async (ctx) => {
		for (let i = 0; i < 120; i++) await ctx.db.insert("photographyClients", client);
	});
	const first = await admin.query(api.crm.scanClientsWithTags, {
		siteUrl,
		paginationOpts: { cursor: null, numItems: 50 },
	});
	const second = await admin.query(api.crm.scanClientsWithTags, {
		siteUrl,
		paginationOpts: { cursor: first.continueCursor, numItems: 50 },
	});
	const options: PaginationOptions = {
		cursor: null,
		numItems: 50,
		endCursor: second.continueCursor,
		maximumRowsRead: 10_000,
		maximumBytesRead: 10_000_000,
	};
	const ranged = await admin.query(api.crm.scanClientsWithTags, {
		siteUrl,
		search: "absent",
		paginationOpts: options,
	});
	expect(ranged).toMatchObject({
		page: [],
		scannedCount: 50,
		isDone: false,
		pageStatus: "SplitRequired",
		continueCursor: first.continueCursor,
	});
	expect(ranged.splitCursor).toBeTruthy();
});

test("retains byte-limited split metadata instead of silently exhausting a search", async () => {
	const { t, admin } = await setup();
	await t.run(async (ctx) => {
		for (let i = 0; i < 20; i++)
			await ctx.db.insert("photographyClients", {
				...client,
				notes: "fictional body ".repeat(10_000),
			});
	});
	const result = await admin.query(api.crm.scanClientsWithTags, {
		siteUrl,
		search: "absent",
		paginationOpts: { cursor: null, numItems: 25, maximumBytesRead: 10_000_000 },
	});
	expect(result.page).toEqual([]);
	expect(result.scannedCount).toBeGreaterThan(0);
	expect(result.scannedCount).toBeLessThan(20);
	expect(result).toMatchObject({ isDone: false, pageStatus: "SplitRequired" });
	expect(result.continueCursor).toBeTruthy();
	expect(result.splitCursor).toBeTruthy();
});
