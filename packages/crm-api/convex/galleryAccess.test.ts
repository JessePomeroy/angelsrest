/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE = "protected-gallery.example";
const ADMIN = "admin@protected-gallery.example";

async function setupProtectedGallery() {
	const t = convexTest(schema, modules);
	await t.mutation(internal.platform.seedClient, {
		name: "Protected Gallery",
		email: ADMIN,
		siteUrl: SITE,
		tier: "full",
		subscriptionStatus: "active",
		adminEmails: [ADMIN],
		role: "client",
	});
	const admin = t.withIdentity({ subject: ADMIN, email: ADMIN, emailVerified: true });
	const clientId = await admin.mutation(api.crm.createClient, {
		siteUrl: SITE,
		name: "Gallery Client",
		email: "client@example.com",
		category: "photography",
		type: "wedding",
	});
	const galleryId = await admin.mutation(api.galleries.create, {
		siteUrl: SITE,
		clientId,
		name: "Protected Delivery",
		slug: "protected-delivery",
		downloadEnabled: true,
		favoritesEnabled: true,
	});
	await admin.mutation(api.galleries.addImage, {
		siteUrl: SITE,
		galleryId,
		r2Key: `${SITE}/${galleryId}/original/photo.jpg`,
		filename: "photo.jpg",
		sizeBytes: 100,
		width: 120,
		height: 80,
	});
	await admin.mutation(api.galleries.update, {
		id: galleryId,
		siteUrl: SITE,
		status: "published",
	});
	await admin.mutation(internal.galleryPasswordStore.setVerifier, {
		galleryId,
		siteUrl: SITE,
		verifier: {
			algorithm: "scrypt",
			salt: "test-salt",
			hash: "test-hash",
			cost: 16_384,
			blockSize: 8,
			parallelization: 1,
			keyLength: 32,
			version: "password-v1",
		},
	});
	const token = await admin.mutation(api.portal.createToken, {
		siteUrl: SITE,
		type: "gallery",
		documentId: galleryId,
		clientId,
	});
	return { t, admin, galleryId, token };
}

describe("gallery password access grants", () => {
	test("protected portal metadata requires a grant and never returns password material", async () => {
		const { t, galleryId, token } = await setupProtectedGallery();
		const portal = await t.query(api.portal.getPublicByToken, { token });

		expect(portal && !portal.expired && portal.requiresPassword).toBe(true);
		if (!portal || portal.expired) throw new Error("Expected a valid gallery portal");
		expect(portal.document).toMatchObject({
			_id: galleryId,
			passwordProtected: true,
		});
		expect(portal.document).not.toHaveProperty("password");
		expect(portal.document).not.toHaveProperty("hash");
		await expect(
			t.query(api.galleries.getImages, { galleryId, token }),
		).rejects.toThrow("Gallery password required");
	});

	test("a current, token-bound grant unlocks reads and favorite mutations", async () => {
		const { t, galleryId, token } = await setupProtectedGallery();
		const issued = await t.mutation(internal.galleryPasswordStore.createGrant, {
			token,
			grant: "server-issued-grant",
			verifierVersion: "password-v1",
		});
		const portal = await t.query(api.portal.getPublicByToken, {
			token,
			accessGrant: issued.accessGrant,
		});
		expect(portal && !portal.expired && portal.requiresPassword).toBe(false);

		const images = await t.query(api.galleries.getImages, {
			galleryId,
			token,
			accessGrant: issued.accessGrant,
		});
		expect(images).toHaveLength(1);
		await t.mutation(api.galleries.updateImage, {
			id: images[0]._id,
			token,
			accessGrant: issued.accessGrant,
			isFavorite: true,
		});
		const updated = await t.run(async (ctx) => await ctx.db.get(images[0]._id));
		expect(updated?.isFavorite).toBe(true);
	});

	test("changing the password version invalidates an existing grant", async () => {
		const { t, admin, galleryId, token } = await setupProtectedGallery();
		const issued = await t.mutation(internal.galleryPasswordStore.createGrant, {
			token,
			grant: "old-grant",
			verifierVersion: "password-v1",
		});
		await admin.mutation(internal.galleryPasswordStore.setVerifier, {
			galleryId,
			siteUrl: SITE,
			verifier: {
				algorithm: "scrypt",
				salt: "new-salt",
				hash: "new-hash",
				cost: 16_384,
				blockSize: 8,
				parallelization: 1,
				keyLength: 32,
				version: "password-v2",
			},
		});
		await expect(
			t.query(api.galleries.getImages, {
				galleryId,
				token,
				accessGrant: issued.accessGrant,
			}),
		).rejects.toThrow("Gallery password required");
	});
});

test("paginated gallery access rechecks grants and resolves RAW companions beyond the page", async () => {
	const { t, admin, galleryId, token } = await setupProtectedGallery();
	await admin.mutation(api.galleries.addImage, { siteUrl: SITE, galleryId, r2Key: `${SITE}/${galleryId}/original/PAIR.CR3`, filename: "PAIR.CR3", sizeBytes: 20, width: 120, height: 80 });
	for (let i = 0; i < 49; i++) await admin.mutation(api.galleries.addImage, { siteUrl: SITE, galleryId, r2Key: `${SITE}/${galleryId}/original/image-${i}.jpg`, filename: `image-${i}.jpg`, sizeBytes: 10, width: 120, height: 80 });
	const companion = await admin.mutation(api.galleries.addImage, { siteUrl: SITE, galleryId, r2Key: `${SITE}/${galleryId}/original/pair.jpg`, filename: "pair.jpg", sizeBytes: 10, width: 120, height: 80 });
	await expect(t.query(api.galleries.getImagesPage, { galleryId, token, cursor: null })).rejects.toThrow("password required");
	const grant = await t.mutation(internal.galleryPasswordStore.createGrant, { token, grant: "page-grant", verifierVersion: "password-v1" });
	const access = { galleryId, token, accessGrant: grant.accessGrant };
	const first = await t.query(api.galleries.getImagesPage, { ...access, cursor: null });
	expect(first.page).toHaveLength(48);
	expect(first.previewSources).toContainEqual({ filename: "pair.jpg", r2Key: `${SITE}/${galleryId}/original/pair.jpg` });
	const second = await t.query(api.galleries.getImagesPage, { ...access, cursor: first.continueCursor });
	expect(second.page).toHaveLength(4);
	expect(new Set([...first.page, ...second.page].map((row) => row._id)).size).toBe(52);
	const selected = await t.query(api.galleries.getImagesPage, { ...access, cursor: first.continueCursor, selection: { kind: "selected", ids: [companion] } });
	expect(selected.page.map((row) => row._id)).toEqual([companion]);
	await t.run(async (ctx) => { const row = await ctx.db.query("portalTokens").withIndex("by_token", (q) => q.eq("token", token)).unique(); if (row) await ctx.db.patch(row._id, { revokedAt: Date.now() }); });
	await expect(t.query(api.galleries.getImagesPage, { ...access, cursor: first.continueCursor })).rejects.toThrow("revoked");
});

test("existing gallery preview indexes backfill before pagination and downloads respect current permissions", async () => {
	const { t, admin, galleryId, token } = await setupProtectedGallery();
	const issued = await t.mutation(internal.galleryPasswordStore.createGrant, { token, grant: "migration-grant", verifierVersion: "password-v1" });
	const args = { galleryId, token, accessGrant: issued.accessGrant, cursor: null };
	await t.run(async (ctx) => { await ctx.db.patch(galleryId, { previewIndexVersion: undefined }); });
	await expect(t.query(api.galleries.getImagesPage, args)).rejects.toThrow("preview index");
	expect(await admin.mutation(api.galleries.backfillPreviewIndex, { galleryId, cursor: null })).toEqual({ isDone: true, cursor: null });
	expect((await t.query(api.galleries.getImagesPage, args)).page).toHaveLength(1);
	await admin.mutation(api.galleries.update, { id: galleryId, siteUrl: SITE, downloadEnabled: false });
	await expect(t.query(api.galleries.getImagesPage, { ...args, selection: { kind: "all", excludedIds: [] } })).rejects.toThrow("Downloads are disabled");
	await expect(t.mutation(api.galleries.backfillPreviewIndex, { galleryId, cursor: null })).rejects.toThrow();
});
