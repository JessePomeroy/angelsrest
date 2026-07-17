/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };
const ASSET_ID = "123e4567-e89b-42d3-a456-426614174000";

function readyAsset(siteUrl = SITE_A.siteUrl) {
	const prefix = `sites/${siteUrl}/web/${ASSET_ID}/`;
	return {
		assetId: ASSET_ID,
		originalFilename: "portfolio.jpg",
		source: {
			contentType: "image/jpeg" as const,
			sizeBytes: 1_000_000,
			width: 3000,
			height: 2000,
		},
		master: {
			key: `${prefix}master.webp`,
			contentType: "image/webp" as const,
			sizeBytes: 700_000,
			width: 3000,
			height: 2000,
		},
		derivatives: {
			thumb: { key: `${prefix}thumb.webp`, contentType: "image/webp" as const, width: 320, height: 213 },
			card: { key: `${prefix}card.webp`, contentType: "image/webp" as const, width: 768, height: 512 },
			display1280: { key: `${prefix}display-1280.webp`, contentType: "image/webp" as const, width: 1280, height: 853 },
			display2048: { key: `${prefix}display-2048.webp`, contentType: "image/webp" as const, width: 2048, height: 1365 },
			display2560: { key: `${prefix}display-2560.webp`, contentType: "image/webp" as const, width: 2560, height: 1707 },
		},
	};
}

async function setup() {
	const t = convexTest(schema, modules);
	for (const site of [SITE_A, SITE_B]) {
		await t.mutation(internal.platform.seedClient, {
			name: site.siteUrl,
			email: site.email,
			siteUrl: site.siteUrl,
			tier: "full",
			subscriptionStatus: "active",
			adminEmails: [site.email],
			role: "client",
		});
	}
	return t;
}

function asAdmin(t: Awaited<ReturnType<typeof setup>>, email: string) {
	return t.withIdentity({ subject: email, email });
}

describe("tenant-scoped CMS media assets", () => {
	test("requires stored site membership for registration and reads", async () => {
		const t = await setup();
		await expect(t.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(),
		})).rejects.toThrow(/Not authenticated/);
		await expect(asAdmin(t, SITE_B.email).mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(),
		})).rejects.toThrow(/Not authorized/);

		const created = await asAdmin(t, SITE_A.email).mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(),
		});
		await expect(asAdmin(t, SITE_B.email).query(api.mediaAssets.get, {
			id: created.id,
		})).rejects.toThrow(/Not authorized/);
	});

	test("validates canonical tenant keys, dimensions, and the web upload ceiling", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.email);
		await expect(admin.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: {
				...readyAsset(),
				master: { ...readyAsset().master, key: "sites/site-b.example/web/wrong/master.webp" },
			},
		})).rejects.toThrow(/Private master key/);
		await expect(admin.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: {
				...readyAsset(),
				source: { ...readyAsset().source, sizeBytes: 20_000_001 },
			},
		})).rejects.toThrow(/upload limit/);
		await expect(admin.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: {
				...readyAsset(),
				derivatives: {
					...readyAsset().derivatives,
					thumb: { ...readyAsset().derivatives.thumb, height: 214 },
				},
			},
		})).rejects.toThrow(/thumb dimensions/);
	});

	test("deduplicates identical registration retries and rejects conflicting metadata", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.email);
		const first = await admin.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(),
		});
		const retry = await admin.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(),
		});
		expect(retry).toEqual(first);
		await expect(admin.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: { ...readyAsset(), originalFilename: "different.jpg" },
		})).rejects.toThrow(/registration conflict/);
	});

	test("paginates one tenant's media library without exposing another tenant", async () => {
		const t = await setup();
		await asAdmin(t, SITE_A.email).mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(),
		});
		await asAdmin(t, SITE_B.email).mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_B.siteUrl,
			asset: readyAsset(SITE_B.siteUrl),
		});
		const result = await asAdmin(t, SITE_A.email).query(api.mediaAssets.listBySite, {
			siteUrl: SITE_A.siteUrl,
			paginationOpts: { numItems: 10, cursor: null },
		});
		expect(result.page).toHaveLength(1);
		expect(result.page[0]?.siteUrl).toBe(SITE_A.siteUrl);
		await expect(asAdmin(t, SITE_A.email).query(api.mediaAssets.listBySite, {
			siteUrl: SITE_A.siteUrl,
			paginationOpts: { numItems: 101, cursor: null },
		})).rejects.toThrow(/cannot exceed 100/);
	});

	test("projects only editor-safe fields and batch-reads placed assets within one tenant", async () => {
		const t = await setup();
		const adminA = asAdmin(t, SITE_A.email);
		const createdA = await adminA.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(),
		});
		const createdB = await asAdmin(t, SITE_B.email).mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_B.siteUrl,
			asset: readyAsset(SITE_B.siteUrl),
		});
		const listed = await adminA.query(api.mediaAssets.listForEditor, {
			siteUrl: SITE_A.siteUrl,
			paginationOpts: { numItems: 10, cursor: null },
		});
		expect(listed.page).toHaveLength(1);
		expect(listed.page[0]).toMatchObject({
			_id: createdA.id,
			originalFilename: "portfolio.jpg",
			status: "ready",
		});
		expect(JSON.stringify(listed.page[0])).not.toContain("master.webp");
		expect(JSON.stringify(listed.page[0])).not.toContain("createdBy");

		const placed = await adminA.query(api.mediaAssets.getManyForEditor, {
			siteUrl: SITE_A.siteUrl,
			ids: [createdA.id],
		});
		expect(placed.map((asset) => asset._id)).toEqual([createdA.id]);
		await expect(adminA.query(api.mediaAssets.getManyForEditor, {
			siteUrl: SITE_A.siteUrl,
			ids: [createdB.id],
		})).rejects.toThrow(/not found/);
	});

	test("keeps deletion retryable and completes only after the explicit cleanup phase", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.email);
		const created = await admin.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(),
		});
		const requested = await admin.mutation(api.mediaAssets.requestDeletion, { id: created.id });
		const retry = await admin.mutation(api.mediaAssets.requestDeletion, { id: created.id });
		expect(retry).toEqual(requested);
		expect(requested.privateKeys).toEqual([readyAsset().master.key]);
		expect(requested.publicKeys).toHaveLength(5);
		expect((await admin.query(api.mediaAssets.get, { id: created.id })).status).toBe("deleting");

		await admin.mutation(api.mediaAssets.completeDeletion, { id: created.id });
		await expect(admin.query(api.mediaAssets.get, { id: created.id })).rejects.toThrow(/Not found/);
	});

	test("blocks deletion while any portfolio placement references the asset", async () => {
		const t = await setup();
		const admin = asAdmin(t, SITE_A.email);
		const created = await admin.mutation(api.mediaAssets.registerReadyWebAsset, {
			siteUrl: SITE_A.siteUrl,
			asset: readyAsset(),
		});
		await t.run(async (ctx) => {
			const now = Date.now();
			const galleryId = await ctx.db.insert("portfolioGalleries", {
				siteUrl: SITE_A.siteUrl,
				slug: "portfolio",
				portfolioOrder: 0,
				isPublished: false,
				createdAt: now,
				createdBy: "test",
				updatedAt: now,
				updatedBy: "test",
			});
			const revisionId = await ctx.db.insert("portfolioGalleryRevisions", {
				siteUrl: SITE_A.siteUrl,
				galleryId,
				schemaVersion: 1,
				slug: "portfolio",
				placementCount: 1,
				checksum: "test-revision",
				source: "admin",
				createdAt: now,
				createdBy: "test",
			});
			await ctx.db.insert("portfolioPlacements", {
				siteUrl: SITE_A.siteUrl,
				galleryId,
				revisionId,
				assetId: created.id as Id<"mediaAssets">,
				placementKey: "test-placement",
				order: 0,
			});
		});

		await expect(admin.mutation(api.mediaAssets.requestDeletion, {
			id: created.id,
		})).rejects.toThrow(/in use by portfolio content/);
	});
});
