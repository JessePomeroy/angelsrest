/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { CatalogProductDraft } from "./helpers/catalogProductValidators";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };

function draft(title: string, slug: string): CatalogProductDraft {
	return {
		title,
		slug,
		description: `${title} description that belongs only in the detail graph.`,
		fulfillmentMode: "production_partner",
		saleAvailability: "available",
		borderOptionsEnabled: false,
		frameOptionsEnabled: true,
		framePriceMultiplierBasisPoints: 12_500,
		variants: [
			{
				key: "matte-small",
				materialOptionKey: "matte",
				sizeOptionKey: "8x10",
				retailPriceCents: 4_200,
				status: "enabled",
			},
		],
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
			catalogProductKinds: ["print"],
		});
	}
	return {
		t,
		adminA: t.withIdentity({ subject: SITE_A.email, email: SITE_A.email }),
		adminB: t.withIdentity({ subject: SITE_B.email, email: SITE_B.email }),
	};
}

type Admin = Awaited<ReturnType<typeof setup>>["adminA"];

async function create(
	admin: Admin,
	siteUrl: string,
	productKey: string,
	productDraft: CatalogProductDraft,
) {
	return await admin.mutation(api.catalogProducts.createDraft, {
		siteUrl,
		productKey,
		draft: productDraft,
	});
}

async function list(admin: Admin, siteUrl: string) {
	return await admin.query(api.catalogProducts.listForEditor, { siteUrl });
}

describe("catalogProducts.listForEditor", () => {
	test("requires tenant membership and returns newest compact print summaries only", async () => {
		const { t, adminA, adminB } = await setup();
		const older = await create(
			adminA,
			SITE_A.siteUrl,
			"older-print",
			draft("Older print", "older-print"),
		);
		const newer = await create(
			adminA,
			SITE_A.siteUrl,
			"newer-print",
			draft("Newer print", "newer-print"),
		);
		await create(
			adminB,
			SITE_B.siteUrl,
			"foreign-print",
			draft("Foreign print", "foreign-print"),
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(older.productId, { createdAt: 10, updatedAt: 11 });
			await ctx.db.patch(newer.productId, { createdAt: 20, updatedAt: 21 });
			await ctx.db.patch(older.revisionId, { createdAt: 10 });
			await ctx.db.patch(newer.revisionId, { createdAt: 20 });
			await ctx.db.insert("catalogProducts", {
				siteUrl: SITE_A.siteUrl,
				productKey: "not-a-single-print",
				productKind: "print_set",
				createdAt: 30,
				createdBy: "fixture",
				updatedAt: 31,
				updatedBy: "fixture",
			});
		});

		await expect(
			t.query(api.catalogProducts.listForEditor, { siteUrl: SITE_A.siteUrl }),
		).rejects.toThrow(/not authenticated/i);
		await expect(list(adminB, SITE_A.siteUrl)).rejects.toThrow(/not authorized/i);

		const summaries = await list(adminA, SITE_A.siteUrl);
		expect(summaries.map(({ productKey }) => productKey)).toEqual([
			"newer-print",
			"older-print",
		]);
		expect(summaries[0]).toEqual({
			productId: newer.productId,
			productKey: "newer-print",
			productKind: "print",
			slug: "newer-print",
			draft: {
				revisionId: newer.revisionId,
				title: "Newer print",
				saleAvailability: "available",
				variantCount: 1,
				createdAt: expect.any(Number),
			},
			published: null,
			createdAt: 20,
			updatedAt: 21,
			publishedAt: null,
		});
		expect(Object.keys(summaries[0]?.draft ?? {}).sort()).toEqual([
			"createdAt",
			"revisionId",
			"saleAvailability",
			"title",
			"variantCount",
		]);
	});

	test("keeps a discarded draft identity as an empty resumable editor row", async () => {
		const { adminA } = await setup();
		const created = await create(
			adminA,
			SITE_A.siteUrl,
			"discarded-print",
			draft("Discarded print", "discarded-print"),
		);
		await adminA.mutation(api.catalogProducts.discardDraft, {
			productId: created.productId,
			draftRevisionId: created.revisionId,
		});
		expect(await list(adminA, SITE_A.siteUrl)).toEqual([
			expect.objectContaining({
				productId: created.productId,
				productKey: "discarded-print",
				slug: null,
				draft: null,
				published: null,
				publishedAt: null,
			}),
		]);
	});

	test("returns the full allowed print list and rejects overflow instead of truncating", async () => {
		const { t, adminA } = await setup();
		await t.run(async (ctx) => {
			for (let index = 0; index < 500; index += 1) {
				await ctx.db.insert("catalogProducts", {
					siteUrl: SITE_A.siteUrl,
					productKey: `bounded-${index}`,
					productKind: "print",
					createdAt: index,
					createdBy: "fixture",
					updatedAt: index,
					updatedBy: "fixture",
				});
			}
		});

		const maximum = await list(adminA, SITE_A.siteUrl);
		expect(maximum).toHaveLength(500);
		expect(maximum[0]?.productKey).toBe("bounded-499");
		expect(maximum[499]?.productKey).toBe("bounded-0");

		await t.run(async (ctx) => {
			await ctx.db.insert("catalogProducts", {
				siteUrl: SITE_A.siteUrl,
				productKey: "bounded-overflow",
				productKind: "print",
				createdAt: 500,
				createdBy: "fixture",
				updatedAt: 500,
				updatedBy: "fixture",
			});
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog print product limit exceeded/i,
		);
	});

	test("fails closed on duplicate stored product keys or non-null slugs", async () => {
		const { t, adminA } = await setup();
		const insertShell = async (productKey: string, slug?: string) =>
			await t.run(async (ctx) =>
				await ctx.db.insert("catalogProducts", {
					siteUrl: SITE_A.siteUrl,
					productKey,
					productKind: "print",
					...(slug ? { slug } : {}),
					createdAt: 1,
					createdBy: "fixture",
					updatedAt: 1,
					updatedBy: "fixture",
				}),
			);
		const duplicateKeyA = await insertShell("duplicate-key");
		const duplicateKeyB = await insertShell("duplicate-key");
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/duplicate catalog product key/i,
		);

		await t.run(async (ctx) => {
			await ctx.db.delete(duplicateKeyA);
			await ctx.db.delete(duplicateKeyB);
		});
		await insertShell("slug-owner-a", "duplicate-slug");
		await insertShell("slug-owner-b", "duplicate-slug");
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/duplicate catalog product slug/i,
		);
	});

	test("proves V1 list key and slug ownership across catalog graph generations", async () => {
		const keyFixture = await setup();
		await create(
			keyFixture.adminA,
			SITE_A.siteUrl,
			"v1-owned-key",
			draft("V1 owned key", "v1-owned-key"),
		);
		await keyFixture.t.run(async (ctx) => {
			await ctx.db.insert("catalogProducts", {
				siteUrl: SITE_A.siteUrl,
				productKey: "v1-owned-key",
				productKind: "tapestry",
				graphVersion: 2,
				slug: "different-v2-slug",
				createdAt: 1,
				createdBy: "fixture",
				updatedAt: 1,
				updatedBy: "fixture",
			});
		});
		await expect(list(keyFixture.adminA, SITE_A.siteUrl)).rejects.toThrow(
			/unique|duplicate|identity ownership|more than one/i,
		);

		const slugFixture = await setup();
		await create(
			slugFixture.adminA,
			SITE_A.siteUrl,
			"v1-owned-slug",
			draft("V1 owned slug", "v1-owned-slug"),
		);
		await slugFixture.t.run(async (ctx) => {
			await ctx.db.insert("catalogProducts", {
				siteUrl: SITE_A.siteUrl,
				productKey: "v2-corrupt-slug-owner",
				productKind: "tapestry",
				graphVersion: 2,
				slug: "v1-owned-slug",
				createdAt: 1,
				createdBy: "fixture",
				updatedAt: 1,
				updatedBy: "fixture",
			});
		});
		await expect(list(slugFixture.adminA, SITE_A.siteUrl)).rejects.toThrow(
			/unique|duplicate|identity ownership|more than one/i,
		);
	});

	test("fails closed on missing or cross-owned revision pointers", async () => {
		const { t, adminA, adminB } = await setup();
		const owner = await create(
			adminA,
			SITE_A.siteUrl,
			"pointer-owner",
			draft("Pointer owner", "pointer-owner"),
		);
		const sibling = await create(
			adminA,
			SITE_A.siteUrl,
			"pointer-sibling",
			draft("Pointer sibling", "pointer-sibling"),
		);
		const foreign = await create(
			adminB,
			SITE_B.siteUrl,
			"pointer-foreign",
			draft("Pointer foreign", "pointer-foreign"),
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(owner.productId, {
				draftRevisionId: sibling.revisionId,
			});
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog revision ownership mismatch/i,
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(owner.productId, {
				draftRevisionId: foreign.revisionId,
			});
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog revision ownership mismatch/i,
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(owner.productId, {
				draftRevisionId: owner.revisionId,
			});
			await ctx.db.delete(owner.revisionId);
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog revision not found/i,
		);
	});

	test("fails closed when stored summary fields exceed semantic bounds", async () => {
		const { t, adminA } = await setup();
		const invalidCount = await create(
			adminA,
			SITE_A.siteUrl,
			"invalid-count",
			draft("Invalid count", "invalid-count"),
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(invalidCount.revisionId, { variantCount: 101 });
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog revision variant count.*bounded/i,
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(invalidCount.revisionId, { variantCount: 1 });
			await ctx.db.patch(invalidCount.productId, { slug: "different-slug" });
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog product slug ownership mismatch/i,
		);
	});

	test("validates safe product and revision timestamps", async () => {
		const { t, adminA } = await setup();
		const created = await create(
			adminA,
			SITE_A.siteUrl,
			"invalid-time",
			draft("Invalid time", "invalid-time"),
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(created.productId, { updatedAt: -1 });
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog product updated timestamp.*non-negative safe integer/i,
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(created.productId, { createdAt: 2, updatedAt: 1 });
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog product updated timestamp cannot precede created timestamp/i,
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(created.productId, { createdAt: 1, updatedAt: 1 });
			await ctx.db.patch(created.revisionId, { createdAt: 1.5 });
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog revision created timestamp.*non-negative safe integer/i,
		);
	});

	test("requires published pointer, timestamp, and actor to move together", async () => {
		const { t, adminA } = await setup();
		const created = await create(
			adminA,
			SITE_A.siteUrl,
			"publication-parity",
			draft("Publication parity", "publication-parity"),
		);
		const publishedAt = Date.now();
		await t.run(async (ctx) => {
			await ctx.db.patch(created.productId, { publishedAt, updatedAt: publishedAt });
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog product publication fields must move together/i,
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(created.productId, {
				publishedRevisionId: created.revisionId,
				publishedBy: "fixture",
			});
		});
		expect(await list(adminA, SITE_A.siteUrl)).toEqual([
			expect.objectContaining({
				productId: created.productId,
				publishedAt,
				published: expect.objectContaining({ revisionId: created.revisionId }),
			}),
		]);
	});

	test("keeps active revision timestamps inside product and publication lifecycles", async () => {
		const { t, adminA } = await setup();
		const created = await create(
			adminA,
			SITE_A.siteUrl,
			"revision-lifecycle",
			draft("Revision lifecycle", "revision-lifecycle"),
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(created.productId, { createdAt: 10, updatedAt: 20 });
			await ctx.db.patch(created.revisionId, { createdAt: 5 });
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog revision timestamp is outside its product lifecycle/i,
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(created.revisionId, { createdAt: 15 });
			await ctx.db.patch(created.productId, {
				publishedRevisionId: created.revisionId,
				publishedAt: 14,
				publishedBy: "fixture",
			});
		});
		await expect(list(adminA, SITE_A.siteUrl)).rejects.toThrow(
			/catalog published revision postdates publication/i,
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(created.productId, { publishedAt: 15 });
		});
		expect(await list(adminA, SITE_A.siteUrl)).toEqual([
			expect.objectContaining({
				productId: created.productId,
				publishedAt: 15,
				published: expect.objectContaining({ revisionId: created.revisionId }),
			}),
		]);
	});

	test("keeps the list header-only while the detail read verifies the full graph", async () => {
		const { t, adminA } = await setup();
		const created = await create(
			adminA,
			SITE_A.siteUrl,
			"corrupt-body",
			draft("Corrupt body", "corrupt-body"),
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(created.revisionId, { checksum: "tampered" });
		});
		expect(await list(adminA, SITE_A.siteUrl)).toEqual([
			expect.objectContaining({
				productId: created.productId,
				draft: expect.objectContaining({ revisionId: created.revisionId }),
			}),
		]);
		await expect(
			adminA.query(api.catalogProducts.getEditorState, {
				productId: created.productId,
			}),
		).rejects.toThrow(/catalog revision checksum mismatch/i);
	});
});
