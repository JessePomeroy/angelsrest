/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import type { PaginationResult } from "convex/server";
import type { Doc } from "./_generated/dataModel";
import { expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
const siteUrl = "delivery-reliability.example";

async function setup() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, { name: "Fictional studio", email: "admin@delivery-reliability.example", siteUrl,
		tier: "full", subscriptionStatus: "active", adminEmails: ["admin@delivery-reliability.example"], role: "client" });
	const admin = t.withIdentity({ subject: "admin", email: "admin@delivery-reliability.example", emailVerified: true });
	const clientId = await admin.mutation(api.crm.createClient, { siteUrl, name: "Fictional client", category: "photography", type: "wedding" });
	const galleryId = await admin.mutation(api.galleries.create, { siteUrl, clientId, name: "Fictional gallery", slug: "fictional", downloadEnabled: true, favoritesEnabled: false });
	return { t, admin, clientId, galleryId };
}

test("delivery pages reach older rows and filter before pagination", async () => {
	const { t, admin, clientId, galleryId } = await setup();
	await admin.mutation(api.galleries.update, { id: galleryId, siteUrl, status: "published" });
	await t.run(async (ctx) => {
		for (let index = 0; index < 101; index++) await ctx.db.insert("galleries", { siteUrl, clientId,
			name: `Archive ${index}`, slug: `archive-${index}`, status: "archived", imageCount: 0, totalSizeBytes: 0, downloadEnabled: false, favoritesEnabled: false });
		await ctx.db.insert("galleries", { siteUrl: "other.example", clientId, name: "Other", slug: "other", status: "published", imageCount: 0, totalSizeBytes: 0, downloadEnabled: false, favoritesEnabled: false });
	});
	const ids = [];
	let cursor: string | null = null;
	for (;;) {
		const page: PaginationResult<Doc<"galleries"> & { clientName: string; passwordProtected: boolean }> = await admin.query(api.galleries.listBySitePaginated, { siteUrl, paginationOpts: { numItems: 25, cursor } });
		expect(page.page.length).toBeLessThanOrEqual(25);
		expect(page.page.every((gallery) => gallery.siteUrl === siteUrl && gallery.clientName === "Fictional client" && gallery.passwordProtected === false)).toBe(true);
		ids.push(...page.page.map((gallery) => gallery._id));
		if (page.isDone) break;
		expect(page.continueCursor).not.toBe(cursor);
		cursor = page.continueCursor;
	}
	expect(new Set(ids).size).toBe(102);
	expect(ids).toContain(galleryId);
	const published = await admin.query(api.galleries.listBySitePaginated, { siteUrl, status: "published", paginationOpts: { numItems: 25, cursor: null } });
	expect(published.page.map((gallery) => gallery._id)).toEqual([galleryId]);
	await expect(t.query(api.galleries.listBySitePaginated, { siteUrl, paginationOpts: { numItems: 25, cursor: null } })).rejects.toThrow();
	await expect(admin.query(api.galleries.listBySitePaginated, { siteUrl: "other.example", paginationOpts: { numItems: 25, cursor: null } })).rejects.toThrow();
});

test("registration and scoped removal can replay without changing gallery totals twice", async () => {
	const { admin, galleryId } = await setup();
	const input = { siteUrl, galleryId, r2Key: `${siteUrl}/${galleryId}/original/photo.jpg`, filename: "photo.jpg", sizeBytes: 100, width: 120, height: 80 };
	const first = await admin.mutation(api.galleries.addImage, input);
	expect(await admin.mutation(api.galleries.addImage, input)).toBe(first);
	expect(await admin.query(api.galleries.get, { id: galleryId })).toMatchObject({ imageCount: 1, totalSizeBytes: 100 });
	await expect(admin.mutation(api.galleries.addImage, { ...input, sizeBytes: 101 })).rejects.toThrow("conflicts");
	await expect(admin.mutation(api.galleries.removeImage, { id: first, siteUrl: "other.example" })).rejects.toThrow();
	expect(await admin.query(api.galleries.get, { id: galleryId })).toMatchObject({ imageCount: 1, totalSizeBytes: 100 });
	await admin.mutation(api.galleries.removeImage, { id: first, siteUrl });
	expect(await admin.mutation(api.galleries.removeImage, { id: first, siteUrl })).toBeNull();
	expect(await admin.query(api.galleries.get, { id: galleryId })).toMatchObject({ imageCount: 0, totalSizeBytes: 0 });
	await expect(admin.mutation(api.galleries.removeImage, { id: first, siteUrl: "other.example" })).rejects.toThrow();
});
