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
	const admin = t.withIdentity({ subject: ADMIN, email: ADMIN });
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
		const portal = await t.query(api.portal.getByToken, { token });

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
		const portal = await t.query(api.portal.getByToken, {
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
