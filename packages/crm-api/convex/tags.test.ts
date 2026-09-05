/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const siteUrl = "tags.example";
beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

async function setup(count: number) {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: "Tags",
		email: "admin@tags.example",
		siteUrl,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: ["admin@tags.example"],
		role: "client",
	});
	const admin = t.withIdentity({
		subject: "admin",
		email: "admin@tags.example",
		emailVerified: true,
	});
	const tagId = await admin.mutation(api.tags.createTag, { siteUrl, name: "Delete me" });
	const otherTagId = await admin.mutation(api.tags.createTag, { siteUrl, name: "Keep me" });
	const clientId = await t.run(async (ctx) => {
		const clientId = await ctx.db.insert("photographyClients", {
			siteUrl,
			name: "Unrelated",
			category: "photography",
			status: "lead",
		});
		await ctx.db.insert("clientTagAssignments", { siteUrl, clientId, tagId: otherTagId });
		for (let i = 0; i < count; i++) {
			const assignedClientId = await ctx.db.insert("photographyClients", {
				siteUrl,
				name: `Client ${i}`,
				category: "photography",
				status: "lead",
			});
			await ctx.db.insert("clientTagAssignments", { siteUrl, clientId: assignedClientId, tagId });
		}
		return clientId;
	});
	return { t, admin, tagId, otherTagId, clientId };
}

test.each([
	0, 500, 501, 1001,
])("deleting a tag completes cleanup of %i assignments", async (count) => {
	const { t, admin, tagId, otherTagId } = await setup(count);
	await admin.mutation(api.tags.deleteTag, { tagId });
	expect(await t.run((ctx) => ctx.db.get(tagId))).toBeNull();
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	const remaining = await t.run((ctx) =>
		ctx.db
			.query("clientTagAssignments")
			.withIndex("by_tagId", (q) => q.eq("tagId", tagId))
			.take(1),
	);
	expect(remaining).toHaveLength(0);
	expect(
		await t.run((ctx) =>
			ctx.db
				.query("clientTagAssignments")
				.withIndex("by_tagId", (q) => q.eq("tagId", otherTagId))
				.take(2),
		),
	).toHaveLength(1);
});

test("a deleted tag cannot acquire new assignments while cleanup is pending", async () => {
	const { t, admin, tagId, clientId } = await setup(501);
	await admin.mutation(api.tags.deleteTag, { tagId });
	await expect(admin.mutation(api.tags.assignTag, { siteUrl, clientId, tagId })).rejects.toThrow(
		"Not found",
	);
	await t.finishAllScheduledFunctions(vi.runAllTimers);
	expect(
		await t.run((ctx) =>
			ctx.db
				.query("clientTagAssignments")
				.withIndex("by_tagId", (q) => q.eq("tagId", tagId))
				.take(1),
		),
	).toHaveLength(0);
});

test("an unrelated identity cannot delete a tag or its assignments", async () => {
	const { t, tagId } = await setup(1);
	const outsider = t.withIdentity({
		subject: "outsider",
		email: "outsider@example.com",
		emailVerified: true,
	});
	await expect(outsider.mutation(api.tags.deleteTag, { tagId })).rejects.toThrow("Not authorized");
	expect(await t.run((ctx) => ctx.db.get(tagId))).not.toBeNull();
	expect(
		await t.run((ctx) =>
			ctx.db
				.query("clientTagAssignments")
				.withIndex("by_tagId", (q) => q.eq("tagId", tagId))
				.take(2),
		),
	).toHaveLength(1);
});
