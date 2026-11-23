/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { deepStrictEqual } from "node:assert/strict";
import { makeFunctionReference, type FunctionArgs } from "convex/server";
import { convexToJson, jsonToConvex } from "convex/values";
import type { Id } from "./_generated/dataModel";
import { convexTest } from "convex-test";
import { afterEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const siteUrl = "crm-audit.example";
afterEach(() => vi.useRealTimers());
async function setup(tier: "full" | "basic" = "full") {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: "CRM",
		email: "admin@crm-audit.example",
		siteUrl,
		tier,
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

const populatedClient = {
	siteUrl,
	name: "Avery Stone",
	category: "web",
	email: "avery@example.invalid",
	phone: "555-0100",
	type: "website" as const,
	source: "referral",
	notes: "Original notes",
	siteUrl_client: "https://avery.example.invalid",
} satisfies FunctionArgs<typeof api.crm.createClient>;

test.each(["http", "websocket"])("persists explicit optional-field clearing through %s encoding", async (transport) => {
	const { admin } = await setup();
	const clientId = await admin.mutation(api.crm.createClient, populatedClient);
	const args: FunctionArgs<typeof api.crm.updateClient> = {
		clientId,
		siteUrl,
		clearFields: ["email", "phone", "type", "source", "notes", "siteUrl_client"],
	};
	const decoded: unknown = transport === "http"
		? JSON.parse(JSON.stringify(args))
		: jsonToConvex(convexToJson(args));
	deepStrictEqual(decoded, args);
	await admin.mutation(api.crm.updateClient, decoded);
	const saved = await admin.query(api.crm.getClient, { clientId });
	for (const field of args.clearFields ?? []) expect(saved).not.toHaveProperty(field);
	expect(saved).toMatchObject({ name: populatedClient.name, siteUrl, category: "web", status: "lead" });
	expect(await admin.query(api.crm.listClients, { siteUrl })).toEqual([saved]);
});

test("preserves omitted fields and keeps status activity when clearing one field", async () => {
	const { admin } = await setup();
	const clientId = await admin.mutation(api.crm.createClient, populatedClient);
	await admin.mutation(api.crm.updateClient, { clientId, siteUrl, name: "Renamed", phone: undefined });
	expect(await admin.query(api.crm.getClient, { clientId })).toMatchObject({ ...populatedClient, name: "Renamed" });
	await admin.mutation(api.crm.updateClient, { clientId, siteUrl, status: "booked", clearFields: ["notes"] });
	const saved = await admin.query(api.crm.getClient, { clientId });
	expect(saved).toMatchObject({ email: populatedClient.email, phone: populatedClient.phone, type: "website", source: "referral", siteUrl_client: populatedClient.siteUrl_client, name: "Renamed", status: "booked" });
	expect(saved).not.toHaveProperty("notes");
	const activity = await admin.query(api.activityLog.getClientActivity, { clientId });
	expect(activity.filter(row => row.action === "status_changed")).toMatchObject([{ description: "status changed to booked" }]);
});

test("rejects conflicting updates atomically", async () => {
	const { admin } = await setup();
	const clientId = await admin.mutation(api.crm.createClient, populatedClient);
	await expect(admin.mutation(api.crm.updateClient, { clientId, siteUrl, name: "Must not persist", status: "booked", notes: "Conflict", clearFields: ["notes"] })).rejects.toThrow("Cannot set and clear notes");
	expect(await admin.query(api.crm.getClient, { clientId })).toMatchObject({ ...populatedClient, status: "lead" });
	expect((await admin.query(api.activityLog.getClientActivity, { clientId })).filter(row => row.action === "status_changed")).toEqual([]);
});

test.each(["name", "siteUrl", "status", "boardColumnId"])("rejects clearing non-allowlisted %s", async (field) => {
	const { admin } = await setup();
	const clientId = await admin.mutation(api.crm.createClient, populatedClient);
	// Widen only attack input to exercise the registered function's runtime validator.
	const untrustedUpdate = makeFunctionReference<"mutation", { clientId: Id<"photographyClients">; siteUrl: string; clearFields: string[] }, null>("crm:updateClient");
	await expect(admin.mutation(untrustedUpdate, { clientId, siteUrl, clearFields: [field] })).rejects.toThrow();
	expect(await admin.query(api.crm.getClient, { clientId })).toMatchObject(populatedClient);
});

test("bounds the clear request before writing", async () => {
	const { admin } = await setup();
	const clientId = await admin.mutation(api.crm.createClient, populatedClient);
	await expect(admin.mutation(api.crm.updateClient, { clientId, siteUrl, clearFields: Array.from({ length: 7 }, () => "email" as const) })).rejects.toThrow("Too many fields");
	expect(await admin.query(api.crm.getClient, { clientId })).toMatchObject(populatedClient);
});

test("keeps authentication and stored-site ownership checks on clears", async () => {
	const { t, admin } = await setup();
	const clientId = await admin.mutation(api.crm.createClient, populatedClient);
	await expect(t.mutation(api.crm.updateClient, { clientId, siteUrl, clearFields: ["notes"] })).rejects.toThrow("Not authenticated");
	const outsider = t.withIdentity({ subject: "outsider", email: "outsider@example.invalid", emailVerified: true });
	await expect(outsider.mutation(api.crm.updateClient, { clientId, siteUrl, clearFields: ["notes"] })).rejects.toThrow("Not authorized");
	const foreignId = await t.run(ctx => ctx.db.insert("photographyClients", { ...populatedClient, siteUrl: "foreign.example.invalid", status: "lead" }));
	await expect(admin.mutation(api.crm.updateClient, { clientId: foreignId, siteUrl, clearFields: ["notes"] })).rejects.toThrow("Not found");
	await expect(admin.mutation(api.crm.updateClient, { clientId, siteUrl: "foreign.example.invalid", clearFields: ["notes"] })).rejects.toThrow("Not authorized");
	expect(await admin.query(api.crm.getClient, { clientId })).toMatchObject(populatedClient);
	expect(await t.run(ctx => ctx.db.get(foreignId))).toMatchObject({ notes: populatedClient.notes });
});

test("requires the CRM feature for clears", async () => {
	const { t, admin } = await setup("basic");
	const clientId = await t.run(ctx => ctx.db.insert("photographyClients", { ...populatedClient, status: "lead" }));
	await expect(admin.mutation(api.crm.updateClient, { clientId, siteUrl, clearFields: ["notes"] })).rejects.toThrow();
	expect(await t.run(ctx => ctx.db.get(clientId))).toMatchObject(populatedClient);
});
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
	await expect(t.query(api.crm.listClients, { siteUrl })).rejects.toThrow("Not authenticated");
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
