/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import * as catalogProductsModule from "./catalogProducts";
import type { CatalogProductDraft } from "./helpers/catalogProductValidators";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const SITE_A = { siteUrl: "site-a.example", email: "admin-a@example.com" };
const SITE_B = { siteUrl: "site-b.example", email: "admin-b@example.com" };

function draft(overrides: Partial<CatalogProductDraft> = {}): CatalogProductDraft {
	return {
		title: "Misty morning",
		slug: "misty-morning",
		description: "An archival print made beside the lake.",
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
			{
				key: "unfinished",
				status: "disabled",
			},
		],
		...overrides,
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

async function save(
	admin: Admin,
	productId: Id<"catalogProducts">,
	productDraft: CatalogProductDraft,
	expectedDraftRevisionId?: Id<"catalogProductRevisions">,
) {
	return await admin.mutation(api.catalogProducts.saveDraft, {
		productId,
		...(expectedDraftRevisionId ? { expectedDraftRevisionId } : {}),
		draft: productDraft,
	});
}

async function discard(
	admin: Admin,
	productId: Id<"catalogProducts">,
	draftRevisionId: Id<"catalogProductRevisions">,
) {
	return await admin.mutation(api.catalogProducts.discardDraft, {
		productId,
		draftRevisionId,
	});
}

async function expectError(operation: Promise<unknown>, message: RegExp) {
	await expect(operation).rejects.toThrow(message);
}

async function variantRows(
	t: Awaited<ReturnType<typeof setup>>["t"],
	revisionId: Id<"catalogProductRevisions">,
) {
	return await t.run(async (ctx) =>
		await ctx.db
			.query("catalogProductVariants")
			.withIndex("by_revisionId_and_order", (q) => q.eq("revisionId", revisionId))
			.collect(),
	);
}

async function graphCounts(
	t: Awaited<ReturnType<typeof setup>>["t"],
	productId: Id<"catalogProducts">,
) {
	return await t.run(async (ctx) => ({
		revisions: (
			await ctx.db
				.query("catalogProductRevisions")
				.withIndex("by_productId_and_createdAt", (q) => q.eq("productId", productId))
				.collect()
		).length,
		variants: (
			await ctx.db
				.query("catalogProductVariants")
				.withIndex("by_productId_and_revisionId", (q) => q.eq("productId", productId))
				.collect()
		).length,
	}));
}

async function expectNoPublishedPointer(
	t: Awaited<ReturnType<typeof setup>>["t"],
	productId: Id<"catalogProducts">,
) {
	const product = await t.run(async (ctx) => await ctx.db.get(productId));
	expect(product).not.toBeNull();
	expect(product?.publishedRevisionId).toBeUndefined();
	expect(product?.publishedAt).toBeUndefined();
	expect(product?.publishedBy).toBeUndefined();
}

describe("tenant-scoped catalog product drafts", () => {
	test("requires authentication and tenant membership for every operation", async () => {
		const { t, adminA, adminB } = await setup();
		await expectError(
			t.mutation(api.catalogProducts.createDraft, {
				siteUrl: SITE_A.siteUrl,
				productKey: "unauthenticated",
				draft: draft(),
			}),
			/not authenticated/i,
		);
		await expectError(
			create(adminB, SITE_A.siteUrl, "cross-tenant-create", draft()),
			/not authorized/i,
		);

		const created = await create(adminA, SITE_A.siteUrl, "owned", draft());
		await expectError(
			t.query(api.catalogProducts.getEditorState, { productId: created.productId }),
			/not authenticated/i,
		);
		await expectError(
			t.mutation(api.catalogProducts.saveDraft, {
				productId: created.productId,
				expectedDraftRevisionId: created.revisionId,
				draft: draft({ title: "Anonymous change" }),
			}),
			/not authenticated/i,
		);
		await expectError(
			t.mutation(api.catalogProducts.discardDraft, {
				productId: created.productId,
				draftRevisionId: created.revisionId,
			}),
			/not authenticated/i,
		);

		await expectError(
			adminB.query(api.catalogProducts.getEditorState, { productId: created.productId }),
			/not authorized/i,
		);
		await expectError(
			save(adminB, created.productId, draft({ title: "Foreign change" }), created.revisionId),
			/not authorized/i,
		);
		await expectError(
			discard(adminB, created.productId, created.revisionId),
			/not authorized/i,
		);

		await t.run(async (ctx) => await ctx.db.delete(created.productId));
		await expectError(
			t.query(api.catalogProducts.getEditorState, { productId: created.productId }),
			/not authenticated/i,
		);
	});

	test("fails closed when a tenant site key resolves to duplicate platform rows", async () => {
		const { t, adminA } = await setup();
		const created = await create(adminA, SITE_A.siteUrl, "before-duplicate", draft());
		await t.run(async (ctx) => {
			await ctx.db.insert("platformClients", {
				name: "duplicate-site-a",
				email: SITE_A.email,
				siteUrl: SITE_A.siteUrl,
				tier: "full",
				subscriptionStatus: "active",
				adminEmails: [SITE_A.email],
				role: "client",
			});
		});

		const duplicateTenant = /unique|more than one|duplicate|ambiguous/i;
		await expectError(
			create(adminA, SITE_A.siteUrl, "after-duplicate", draft()),
			duplicateTenant,
		);
		await expectError(
			adminA.query(api.catalogProducts.getEditorState, { productId: created.productId }),
			duplicateTenant,
		);
		await expectError(
			save(adminA, created.productId, draft({ title: "Blocked" }), created.revisionId),
			duplicateTenant,
		);
		await expectError(
			discard(adminA, created.productId, created.revisionId),
			duplicateTenant,
		);
	});

	test("deduplicates exact create retries and rejects a key reused with different content", async () => {
		const { t, adminA } = await setup();
		const initial = draft();
		const created = await create(adminA, SITE_A.siteUrl, "retryable", initial);
		expect(await create(adminA, SITE_A.siteUrl, "retryable", initial)).toEqual(created);
		expect(await graphCounts(t, created.productId)).toEqual({
			revisions: 1,
			variants: initial.variants.length,
		});
		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"retryable",
				draft({ description: "Different content under the same identity" }),
			),
			/key.*exists|conflict/i,
		);
		expect(await graphCounts(t, created.productId)).toEqual({
			revisions: 1,
			variants: initial.variants.length,
		});
	});

	test("saves immutable ordered graphs, deduplicates exact retries, and rejects stale writes", async () => {
		const { t, adminA } = await setup();
		const initialDraft = draft();
		const first = await create(adminA, SITE_A.siteUrl, "immutable", initialDraft);
		const firstRevisionBefore = await t.run(async (ctx) => await ctx.db.get(first.revisionId));
		const firstVariantsBefore = await variantRows(t, first.revisionId);
		const changedDraft = draft({
			title: "Second immutable draft",
			variants: [
				{
					key: "canvas-large",
					materialOptionKey: "canvas",
					sizeOptionKey: "20x30",
					retailPriceCents: 16_500,
					status: "enabled",
				},
				{
					key: "matte-small",
					materialOptionKey: "matte",
					sizeOptionKey: "8x10",
					retailPriceCents: 4_500,
					status: "disabled",
				},
			],
		});
		const second = await save(adminA, first.productId, changedDraft, first.revisionId);
		expect(
			await save(adminA, first.productId, changedDraft, first.revisionId),
		).toEqual(second);
		expect(await graphCounts(t, first.productId)).toEqual({ revisions: 2, variants: 4 });

		expect(await t.run(async (ctx) => await ctx.db.get(first.revisionId))).toEqual(
			firstRevisionBefore,
		);
		expect(await variantRows(t, first.revisionId)).toEqual(firstVariantsBefore);
		const secondRows = await variantRows(t, second.revisionId);
		expect(secondRows.map(({ variantKey, order }) => [variantKey, order])).toEqual([
			["canvas-large", 0],
			["matte-small", 1],
		]);
		expect(firstVariantsBefore[1]).toMatchObject({
			variantKey: "unfinished",
			status: "disabled",
		});
		expect(firstVariantsBefore[1]?.materialOptionKey).toBeUndefined();
		expect(firstVariantsBefore[1]?.sizeOptionKey).toBeUndefined();

		await expectError(
			save(
				adminA,
				first.productId,
				draft({ title: "Stale overwrite" }),
				first.revisionId,
			),
			/conflict/i,
		);
		await expectError(
			discard(adminA, first.productId, first.revisionId),
			/conflict|current draft/i,
		);
		const product = await t.run(async (ctx) => await ctx.db.get(first.productId));
		expect(product?.draftRevisionId).toBe(second.revisionId);
		expect(await graphCounts(t, first.productId)).toEqual({ revisions: 2, variants: 4 });
	});

	test("allows exactly one concurrent save from the same draft pointer", async () => {
		const { t, adminA } = await setup();
		const created = await create(adminA, SITE_A.siteUrl, "concurrent", draft());
		const attempts = await Promise.allSettled([
			save(
				adminA,
				created.productId,
				draft({ title: "Concurrent A" }),
				created.revisionId,
			),
			save(
				adminA,
				created.productId,
				draft({ title: "Concurrent B" }),
				created.revisionId,
			),
		]);
		expect(attempts.filter(({ status }) => status === "fulfilled")).toHaveLength(1);
		expect(attempts.filter(({ status }) => status === "rejected")).toHaveLength(1);
		expect(await graphCounts(t, created.productId)).toEqual({ revisions: 2, variants: 4 });
	});

	test("discards only the active pointer and makes an exact retry harmless", async () => {
		const { t, adminA } = await setup();
		const created = await create(adminA, SITE_A.siteUrl, "discarded", draft());
		const other = await create(
			adminA,
			SITE_A.siteUrl,
			"foreign-revision",
			draft({ slug: "foreign-revision" }),
		);
		await discard(adminA, created.productId, created.revisionId);
		await discard(adminA, created.productId, created.revisionId);

		const product = await t.run(async (ctx) => await ctx.db.get(created.productId));
		expect(product?.draftRevisionId).toBeUndefined();
		expect(product?.slug).toBeUndefined();
		expect(await graphCounts(t, created.productId)).toEqual({
			revisions: 1,
			variants: draft().variants.length,
		});
		expect(await t.run(async (ctx) => await ctx.db.get(created.revisionId))).not.toBeNull();
		expect(await variantRows(t, created.revisionId)).toHaveLength(draft().variants.length);

		await expectError(
			discard(adminA, created.productId, other.revisionId),
			/ownership|does not belong|conflict|foreign/i,
		);
		expect(await graphCounts(t, created.productId)).toEqual({
			revisions: 1,
			variants: draft().variants.length,
		});

		const resumedDraft = draft({ title: "Resumed after discard", slug: "resumed" });
		const resumed = await save(adminA, created.productId, resumedDraft);
		expect(
			await adminA.query(api.catalogProducts.getEditorState, {
				productId: created.productId,
			}),
		).toMatchObject({
			slug: "resumed",
			draft: { revisionId: resumed.revisionId, title: "Resumed after discard" },
		});
		expect(await graphCounts(t, created.productId)).toEqual({
			revisions: 2,
			variants: resumedDraft.variants.length * 2,
		});
	});

	test("stores integer cents unchanged and rejects invalid prices", async () => {
		const { t, adminA } = await setup();
		const valid = await create(
			adminA,
			SITE_A.siteUrl,
			"integer-cents",
			draft({
				variants: [
					{ key: "priced", retailPriceCents: 4_200, status: "enabled" },
					{ key: "zero", retailPriceCents: 0, status: "disabled" },
				],
			}),
		);
		expect(
			(await variantRows(t, valid.revisionId)).map(({ retailPriceCents }) =>
				retailPriceCents
			),
		).toEqual([4_200, 0]);

		for (const [index, retailPriceCents] of [
			-1,
			1.5,
			Number.MAX_SAFE_INTEGER + 1,
			Number.NaN,
			Number.POSITIVE_INFINITY,
		].entries()) {
			await expectError(
				create(
					adminA,
					SITE_A.siteUrl,
					`invalid-cents-${index}`,
					draft({
						slug: `invalid-cents-${index}`,
						variants: [{
							key: "invalid",
							retailPriceCents,
							status: "enabled",
						}],
					}),
				),
				/retail price cents|safe integer|bounded non-negative/i,
			);
		}
		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"fractional-markup",
				draft({ framePriceMultiplierBasisPoints: 12.5 }),
			),
			/frame price multiplier basis points.*integer/i,
		);
	});

	test("keeps product kind, fulfillment mode, currency, and provider identity separate", async () => {
		const { t, adminA } = await setup();
		const partner = await create(
			adminA,
			SITE_A.siteUrl,
			"production-partner",
			draft(),
		);
		const merchant = await create(
			adminA,
			SITE_A.siteUrl,
			"merchant-fulfilled",
			draft({ slug: "merchant-fulfilled", fulfillmentMode: "merchant_fulfilled" }),
		);
		const stored = await t.run(async (ctx) => ({
			partnerProduct: await ctx.db.get(partner.productId),
			partnerRevision: await ctx.db.get(partner.revisionId),
			merchantRevision: await ctx.db.get(merchant.revisionId),
		}));
		expect(stored.partnerProduct?.productKind).toBe("print");
		expect(stored.partnerRevision).toMatchObject({
			productKind: "print",
			currency: "usd",
			fulfillmentMode: "production_partner",
		});
		expect(stored.merchantRevision).toMatchObject({
			productKind: "print",
			currency: "usd",
			fulfillmentMode: "merchant_fulfilled",
		});
			expect(
				Object.keys(stored.partnerRevision ?? {}).filter((key) => /provider|luma/i.test(key)),
			).toEqual([]);

		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"digital-print",
				draft({ fulfillmentMode: "digital_delivery" }),
			),
			/print.*digital delivery|digital delivery.*print/i,
		);
		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"provider-as-mode",
				{
					...draft(),
					fulfillmentMode: "lumaprints",
				} as unknown as CatalogProductDraft,
			),
			/expected one of|invalid value|does not match|fulfillmentMode|union/i,
		);
		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"forged-kind-currency",
				{
					...draft(),
					productKind: "digital_download",
					currency: "eur",
				} as CatalogProductDraft,
			),
			/unexpected field|extra field|productKind|currency/i,
		);
	});

	test("rejects duplicate variant identity and selection while retaining incomplete disabled rows", async () => {
		const { t, adminA } = await setup();
		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"duplicate-keys",
				draft({
					variants: [
						{ key: "same", status: "enabled" },
						{ key: "same", status: "disabled" },
					],
				}),
			),
			/variant keys.*unique|unique.*variant/i,
		);
		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"duplicate-combination",
				draft({
					variants: [
						{
							key: "first",
							materialOptionKey: "matte",
							sizeOptionKey: "8x10",
							status: "enabled",
						},
						{
							key: "disabled-duplicate",
							materialOptionKey: "matte",
							sizeOptionKey: "8x10",
							status: "disabled",
						},
					],
				}),
			),
			/material.*size combination.*once|duplicate.*combination/i,
		);
		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"empty-option-key",
				draft({
					slug: "empty-option-key",
					variants: [{
						key: "empty-material",
						materialOptionKey: "",
						status: "disabled",
					}],
				}),
			),
			/stable lowercase option key/i,
		);
		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"empty-slug",
				draft({ slug: "" }),
			),
			/product slug/i,
		);

		const incomplete = await create(
			adminA,
			SITE_A.siteUrl,
			"incomplete-variants",
			draft({
				variants: [
					{ key: "material-only", materialOptionKey: "matte", status: "disabled" },
					{ key: "another-material-only", materialOptionKey: "matte", status: "disabled" },
				],
			}),
		);
		expect(await variantRows(t, incomplete.revisionId)).toMatchObject([
			{ variantKey: "material-only", order: 0, status: "disabled" },
			{ variantKey: "another-material-only", order: 1, status: "disabled" },
		]);
	});

	test("accepts exactly 100 ordered variants and rejects 101", async () => {
		const { t, adminA } = await setup();
		const variants = Array.from({ length: 100 }, (_, index) => ({
			key: `variant-${index}`,
			materialOptionKey: `material-${index}`,
			sizeOptionKey: `size-${index}`,
			retailPriceCents: index,
			status: index % 2 === 0 ? "enabled" as const : "disabled" as const,
		}));
		const maximum = await create(
			adminA,
			SITE_A.siteUrl,
			"maximum-variants",
			draft({ variants }),
		);
		const rows = await variantRows(t, maximum.revisionId);
		expect(rows).toHaveLength(100);
		expect(rows.map(({ variantKey }) => variantKey)).toEqual(
			variants.map(({ key }) => key),
		);
		expect(rows.map(({ order }) => order)).toEqual(
			Array.from({ length: 100 }, (_, index) => index),
		);

		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"too-many-variants",
				draft({
					slug: "too-many-variants",
					variants: [
						...variants,
						{
							key: "variant-100",
							materialOptionKey: "material-100",
							sizeOptionKey: "size-100",
							status: "enabled",
						},
					],
				}),
			),
			/cannot exceed 100 variants|100 variants/i,
		);
	});

	test("rejects a 501st print identity without leaving an orphan graph", async () => {
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
		await expectError(
			create(adminA, SITE_A.siteUrl, "over-product-limit", draft()),
			/cannot exceed 500 print products/i,
		);
		const stored = await t.run(async (ctx) => ({
			products: await ctx.db
				.query("catalogProducts")
				.withIndex("by_siteUrl_and_productKind_and_createdAt", (q) =>
					q.eq("siteUrl", SITE_A.siteUrl).eq("productKind", "print"),
				)
				.take(501),
			revisions: await ctx.db.query("catalogProductRevisions").take(1),
			variants: await ctx.db.query("catalogProductVariants").take(1),
		}));
		expect(stored.products).toHaveLength(500);
		expect(stored.revisions).toEqual([]);
		expect(stored.variants).toEqual([]);
	});

	test("scopes product keys and draft slugs to one tenant", async () => {
		const { t, adminA, adminB } = await setup();
		const tenantA = await create(
			adminA,
			SITE_A.siteUrl,
			"shared-key",
			draft({ slug: "shared-slug" }),
		);
		const tenantB = await create(
			adminB,
			SITE_B.siteUrl,
			"shared-key",
			draft({ slug: "shared-slug" }),
		);
		expect(tenantB.productId).not.toBe(tenantA.productId);
		await expectError(
			create(
				adminA,
				SITE_A.siteUrl,
				"different-key",
				draft({ slug: "shared-slug" }),
			),
			/slug.*already exists/i,
		);

		const slugged = await create(
			adminA,
			SITE_A.siteUrl,
			"mutable-slug",
			draft({ slug: "first-slug" }),
		);
		await expectError(
			save(
				adminA,
				slugged.productId,
				draft({ slug: "shared-slug", title: "Colliding save" }),
				slugged.revisionId,
			),
			/slug.*already exists/i,
		);
		expect(await graphCounts(t, slugged.productId)).toEqual({ revisions: 1, variants: 2 });
		expect(
			await adminA.query(api.catalogProducts.getEditorState, {
				productId: slugged.productId,
			}),
		).toMatchObject({ slug: "first-slug", draft: { revisionId: slugged.revisionId } });

		const changed = await save(
			adminA,
			slugged.productId,
			draft({ slug: "second-slug", title: "Changed before publication" }),
			slugged.revisionId,
		);
		const stored = await t.run(async (ctx) => ({
			product: await ctx.db.get(slugged.productId),
			first: await ctx.db.get(slugged.revisionId),
			second: await ctx.db.get(changed.revisionId),
		}));
		expect(stored.product?.slug).toBe("second-slug");
		expect(stored.first?.slug).toBe("first-slug");
		expect(stored.second?.slug).toBe("second-slug");
	});

	test("fails closed when a product points to another product or tenant revision", async () => {
		const { t, adminA, adminB } = await setup();
		const local = await create(
			adminA,
			SITE_A.siteUrl,
			"pointer-local",
			draft({ slug: "pointer-local" }),
		);
		const sameTenant = await create(
			adminA,
			SITE_A.siteUrl,
			"pointer-same-tenant",
			draft({ slug: "pointer-same-tenant" }),
		);
		const foreignTenant = await create(
			adminB,
			SITE_B.siteUrl,
			"pointer-foreign-tenant",
			draft({ slug: "pointer-foreign-tenant" }),
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(local.productId, {
				draftRevisionId: sameTenant.revisionId,
			});
		});
		await expectError(
			adminA.query(api.catalogProducts.getEditorState, { productId: local.productId }),
			/revision ownership mismatch/i,
		);

		await t.run(async (ctx) => {
			await ctx.db.patch(local.productId, {
				draftRevisionId: foreignTenant.revisionId,
			});
		});
		await expectError(
			adminA.query(api.catalogProducts.getEditorState, { productId: local.productId }),
			/revision ownership mismatch/i,
		);
	});

	test("fails closed on corrupt variant ownership, count, order, checksum, or slug", async () => {
		const { t, adminA } = await setup();
		const owner = await create(
			adminA,
			SITE_A.siteUrl,
			"corrupt-owner",
			draft({ slug: "corrupt-owner" }),
		);
		const other = await create(
			adminA,
			SITE_A.siteUrl,
			"corrupt-other",
			draft({ slug: "corrupt-other" }),
		);
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query("catalogProductVariants")
				.withIndex("by_revisionId_and_order", (q) =>
					q.eq("revisionId", owner.revisionId)
				)
				.first();
			if (!row) throw new Error("Expected a catalog variant");
			await ctx.db.patch(row._id, { productId: other.productId });
		});
		await expectError(
			adminA.query(api.catalogProducts.getEditorState, { productId: owner.productId }),
			/variant ownership mismatch/i,
		);

		const badCount = await create(
			adminA,
			SITE_A.siteUrl,
			"corrupt-count",
			draft({ slug: "corrupt-count" }),
		);
		await t.run(async (ctx) => {
			const revision = await ctx.db.get(badCount.revisionId);
			if (!revision) throw new Error("Expected a catalog revision");
			await ctx.db.patch(revision._id, { variantCount: revision.variantCount + 1 });
		});
		await expectError(
			adminA.query(api.catalogProducts.getEditorState, { productId: badCount.productId }),
			/variant count mismatch/i,
		);

		const badOrder = await create(
			adminA,
			SITE_A.siteUrl,
			"corrupt-order",
			draft({ slug: "corrupt-order" }),
		);
		await t.run(async (ctx) => {
			const row = await ctx.db
				.query("catalogProductVariants")
				.withIndex("by_revisionId_and_order", (q) =>
					q.eq("revisionId", badOrder.revisionId)
				)
				.first();
			if (!row) throw new Error("Expected a catalog variant");
			await ctx.db.patch(row._id, { order: 7 });
		});
		await expectError(
			adminA.query(api.catalogProducts.getEditorState, { productId: badOrder.productId }),
			/variant order.*contiguous/i,
		);

		const badChecksum = await create(
			adminA,
			SITE_A.siteUrl,
			"corrupt-checksum",
			draft({ slug: "corrupt-checksum" }),
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(badChecksum.revisionId, { checksum: "tampered" });
		});
		await expectError(
			adminA.query(api.catalogProducts.getEditorState, {
				productId: badChecksum.productId,
			}),
			/revision checksum mismatch/i,
		);

		const badSlug = await create(
			adminA,
			SITE_A.siteUrl,
			"corrupt-slug",
			draft({ slug: "corrupt-slug" }),
		);
		await t.run(async (ctx) => {
			await ctx.db.patch(badSlug.productId, { slug: "different-slug" });
		});
		await expectError(
			adminA.query(api.catalogProducts.getEditorState, { productId: badSlug.productId }),
			/slug ownership mismatch/i,
		);
	});

	test("keeps publication unreachable and publication pointers absent", async () => {
		const { t, adminA } = await setup();
		expect(Object.keys(catalogProductsModule).sort()).toEqual([
			"createDraft",
			"discardDraft",
			"getEditorState",
			"listForEditor",
			"saveDraft",
		]);

		const created = await create(
			adminA,
			SITE_A.siteUrl,
			"draft-only",
			draft(),
		);
		await expectNoPublishedPointer(t, created.productId);
		const editor = await adminA.query(api.catalogProducts.getEditorState, {
			productId: created.productId,
		});
		expect(editor).toEqual({
			productId: created.productId,
			productKey: "draft-only",
			productKind: "print",
			slug: "misty-morning",
			published: null,
			publishedAt: null,
			updatedAt: expect.any(Number),
			draft: {
				revisionId: created.revisionId,
				schemaVersion: 1,
				productKind: "print",
				currency: "usd",
				title: "Misty morning",
				slug: "misty-morning",
				description: "An archival print made beside the lake.",
				fulfillmentMode: "production_partner",
				saleAvailability: "available",
				borderOptionsEnabled: false,
				frameOptionsEnabled: true,
				framePriceMultiplierBasisPoints: 12_500,
				variantCount: 2,
				checksum: expect.stringMatching(/^[0-9a-f]{64}$/),
				source: "admin",
				createdAt: expect.any(Number),
				variants: [
					{
						key: "matte-small",
						order: 0,
						materialOptionKey: "matte",
						sizeOptionKey: "8x10",
						retailPriceCents: 4_200,
						status: "enabled",
					},
					{
						key: "unfinished",
						order: 1,
						materialOptionKey: null,
						sizeOptionKey: null,
						retailPriceCents: null,
						status: "disabled",
					},
				],
			},
		});

		const saved = await save(
			adminA,
			created.productId,
			draft({ title: "Still private" }),
			created.revisionId,
		);
		await expectNoPublishedPointer(t, created.productId);
		await discard(adminA, created.productId, saved.revisionId);
		await expectNoPublishedPointer(t, created.productId);
		expect(
			await adminA.query(api.catalogProducts.getEditorState, {
				productId: created.productId,
			}),
		).toMatchObject({ draft: null, published: null, publishedAt: null });
	});
});
