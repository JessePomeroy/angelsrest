/// <reference types="vite/client" />
// @vitest-environment edge-runtime
import { convexTest } from "convex-test";
import { expect, test } from "vitest";
import { api } from "./_generated/api";
import schema from "./schema";
const modules = import.meta.glob("./**/*.ts");
test("recovers an original identity after reload, registers idempotently, and preserves deletion tombstones", async () => {
	const t = convexTest(schema, modules);
	const siteUrl = "uploads.example",
		email = "owner@example.test";
	await t.run((ctx) =>
		ctx.db.insert("platformClients", {
			siteUrl,
			email,
			name: "Synthetic",
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [email],
			role: "client",
		}),
	);
	const admin = t.withIdentity({ subject: email, email, emailVerified: true });
	const clientId = await admin.mutation(api.crm.createClient, {
		siteUrl,
		name: "Synthetic Client",
		email: "client@example.test",
		category: "photography",
		type: "portrait",
	});
	const galleryId = await admin.mutation(api.galleries.create, {
		siteUrl,
		name: "Synthetic Gallery",
		clientId,
		slug: "synthetic",
		downloadEnabled: true,
		favoritesEnabled: true,
	});
	const facts = {
		siteUrl,
		galleryId,
		r2Key: `${siteUrl}/${galleryId}/original/synthetic.jpg`,
		filename: "synthetic.jpg",
		sizeBytes: 100,
		width: 10,
		height: 10,
	};
	const id = await admin.mutation(api.deliveryUploads.begin, facts);
	expect(await admin.mutation(api.deliveryUploads.begin, facts)).toBe(id);
	const reopened = t.withIdentity({ subject: email, email, emailVerified: true });
	expect(
		(
			await reopened.query(api.deliveryUploads.list, {
				siteUrl,
				galleryId,
				paginationOpts: { numItems: 25, cursor: null },
			})
		).page.map((row) => row._id),
	).toContain(id);
	const imageId = await reopened.mutation(api.galleries.addImage, facts);
	expect(await reopened.mutation(api.galleries.addImage, facts)).toBe(imageId);
	expect(
		(
			await reopened.query(api.deliveryUploads.list, {
				siteUrl,
				galleryId,
				paginationOpts: { numItems: 25, cursor: null },
			})
		).page,
	).toHaveLength(0);
	expect(await reopened.mutation(api.deliveryUploads.markDeleting, { siteUrl, id })).toBe(imageId);
	await expect(reopened.mutation(api.galleries.addImage, facts)).rejects.toThrow();
	await expect(
		reopened.mutation(api.deliveryUploads.finishDelete, { siteUrl, id }),
	).rejects.toThrow();
	await reopened.mutation(api.galleries.removeImage, { siteUrl, id: imageId });
	await reopened.mutation(api.deliveryUploads.finishDelete, { siteUrl, id });
	await expect(reopened.mutation(api.galleries.addImage, facts)).rejects.toThrow();
	expect((await reopened.query(api.galleries.get, { id: galleryId }))?.imageCount).toBe(0);
	await expect(
		t
			.withIdentity({ subject: "foreign", email: "foreign@example.test", emailVerified: true })
			.query(api.deliveryUploads.list, {
				siteUrl,
				galleryId,
				paginationOpts: { numItems: 25, cursor: null },
			}),
	).rejects.toThrow();
	await expect(
		admin.mutation(api.deliveryUploads.begin, {
			...facts,
			r2Key: `other.example/${galleryId}/original/x.jpg`,
		}),
	).rejects.toThrow();
});
