/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { describe, expect, test } from "vitest";
import {
	createGraph,
	graphDraft,
	graphRows,
	saveGraph,
	SITE_A,
	setup,
	storedCounts,
	v1Draft,
} from "../test/catalogProductGraphFixtures";
import { api } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { CatalogProductGraphV2Draft } from "./helpers/catalogProductGraphValidators";
import { CATALOG_PRODUCT_KIND_ORDER } from "./helpers/catalogProductPolicy";

const modules = import.meta.glob("./**/*.ts");
type Fixture = Awaited<ReturnType<typeof setup>>;
type PublicationArgs = {
	productId: Id<"catalogProducts">;
	expectedDraftRevisionId: Id<"catalogProductRevisions"> | null;
	expectedPublishedRevisionId: Id<"catalogProductRevisions"> | null;
	expectedUpdatedAt: number;
};

async function product(fixture: Fixture, productId: Id<"catalogProducts">) {
	const value = await fixture.t.run(async (ctx) => await ctx.db.get(productId));
	if (!value) throw new Error("Product fixture is missing");
	return value;
}

async function publicationArgs(
	fixture: Fixture,
	productId: Id<"catalogProducts">,
): Promise<PublicationArgs> {
	const value = await product(fixture, productId);
	return {
		productId,
		expectedDraftRevisionId: value.draftRevisionId ?? null,
		expectedPublishedRevisionId: value.publishedRevisionId ?? null,
		expectedUpdatedAt: value.updatedAt,
	};
}

function allKeys(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(allKeys);
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, entry]) => [key, ...allKeys(entry)]);
}

async function insertBareProducts(
	fixture: Fixture,
	count: number,
	fields: (index: number) => Partial<Doc<"catalogProducts">> = () => ({}),
) {
	await fixture.t.run(async (ctx) => {
		for (let index = 0; index < count; index += 1) {
			await ctx.db.insert("catalogProducts", {
				siteUrl: SITE_A.siteUrl,
				productKey: `overflow-${index}`,
				productKind: "postcard",
				graphVersion: 2,
				slug: `overflow-${index}`,
				createdAt: 1,
				createdBy: "fixture",
				updatedAt: 1,
				updatedBy: "fixture",
				...fields(index),
			});
		}
	});
}

describe("catalog V2 publication lifecycle", () => {
	test.each(CATALOG_PRODUCT_KIND_ORDER)("publishes and unpublishes one complete %s graph without changing history", async (kind) => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			`lifecycle-${kind}`,
			graphDraft(kind, fixture, `lifecycle-${kind}`),
		);
		const beforeCounts = await storedCounts(fixture);
		const beforeRows = await graphRows(fixture, created.revisionId);
		const publishArgs = await publicationArgs(fixture, created.productId);
		const published = await fixture.adminA.mutation(
			api.catalogProductGraphs.publishDraft,
			publishArgs,
		);
		expect(published).toMatchObject({
			productId: created.productId,
			draftRevisionId: created.revisionId,
			publishedRevisionId: created.revisionId,
		});
		expect(published.updatedAt).toBeGreaterThan(publishArgs.expectedUpdatedAt);
		expect(published.publishedAt).toBe(published.updatedAt);
		const storedPublished = await product(fixture, created.productId);
		expect(storedPublished.updatedBy).toBe(storedPublished.createdBy);
		expect(storedPublished.publishedBy).toBe(storedPublished.createdBy);
		expect(await fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: `lifecycle-${kind.replaceAll("_", "-")}`,
		})).toMatchObject({ productKind: kind, revisionId: created.revisionId });

		const unpublishArgs = await publicationArgs(fixture, created.productId);
		const unpublished = await fixture.adminA.mutation(
			api.catalogProductGraphs.unpublish,
			unpublishArgs,
		);
		expect(unpublished).toMatchObject({
			productId: created.productId,
			draftRevisionId: created.revisionId,
			publishedRevisionId: null,
			publishedAt: null,
		});
		expect(unpublished.updatedAt).toBeGreaterThan(unpublishArgs.expectedUpdatedAt);
		const storedUnpublished = await product(fixture, created.productId);
		expect(storedUnpublished.updatedBy).toBe(storedUnpublished.createdBy);
		expect(storedUnpublished.publishedBy).toBeUndefined();
		expect(await storedCounts(fixture)).toEqual(beforeCounts);
		expect(await graphRows(fixture, created.revisionId)).toEqual(beforeRows);
		expect(await fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: `lifecycle-${kind.replaceAll("_", "-")}`,
		})).toBeNull();
	});

	test.each(["publishDraft", "unpublish"] as const)(
		"authorizes %s before state, enforces tenant policy, and leaves rejected state unchanged",
		async (operation) => {
			const fixture = await setup(modules);
			const slug = `authorization-${operation.toLowerCase()}`;
			const created = await createGraph(
				fixture.adminA,
				SITE_A.siteUrl,
				slug,
				graphDraft("print", fixture, slug),
			);
			if (operation === "unpublish") {
				await fixture.adminA.mutation(
					api.catalogProductGraphs.publishDraft,
					await publicationArgs(fixture, created.productId),
				);
			}
			const mutation = operation === "publishDraft"
				? api.catalogProductGraphs.publishDraft
				: api.catalogProductGraphs.unpublish;
			const args = await publicationArgs(fixture, created.productId);
			const before = await product(fixture, created.productId);
			await expect(fixture.t.mutation(mutation, args)).rejects.toThrow(/not authenticated/i);
			await expect(fixture.adminB.mutation(mutation, args)).rejects.toThrow(/not authorized/i);
			await fixture.t.run(async (ctx) => {
				const client = await ctx.db.query("platformClients")
					.withIndex("by_siteUrl", (q) => q.eq("siteUrl", SITE_A.siteUrl)).unique();
				if (!client) throw new Error("Client fixture is missing");
				await ctx.db.patch(client._id, { catalogProductKinds: ["postcard"] });
			});
			await expect(fixture.adminA.mutation(mutation, args)).rejects.toThrow(/not enabled/i);
			expect(await product(fixture, created.productId)).toEqual(before);
		},
	);

	test.each(["publishDraft", "unpublish"] as const)(
		"rejects V1 products through the registered %s mutation",
		async (operation) => {
			const fixture = await setup(modules);
			const slug = `legacy-${operation.toLowerCase()}`;
			const legacy = await fixture.adminA.mutation(api.catalogProducts.createDraft, {
				siteUrl: SITE_A.siteUrl,
				productKey: slug,
				draft: v1Draft(slug),
			});
			const mutation = operation === "publishDraft"
				? api.catalogProductGraphs.publishDraft
				: api.catalogProductGraphs.unpublish;
			await expect(fixture.adminA.mutation(
				mutation,
				await publicationArgs(fixture, legacy.productId),
			)).rejects.toThrow(/not a V2 graph product/i);
		},
	);

	test.each(["publishDraft", "unpublish"] as const)(
		"requires every expected CAS field for %s and conflicts on an independent duplicate submission",
		async (operation) => {
			const fixture = await setup(modules);
			const slug = `cas-${operation.toLowerCase()}`;
			const created = await createGraph(
				fixture.adminA,
				SITE_A.siteUrl,
				slug,
				graphDraft("postcard", fixture, slug),
			);
			if (operation === "unpublish") {
				await fixture.adminA.mutation(
					api.catalogProductGraphs.publishDraft,
					await publicationArgs(fixture, created.productId),
				);
			}
			const mutation = operation === "publishDraft"
				? api.catalogProductGraphs.publishDraft
				: api.catalogProductGraphs.unpublish;
			const args = await publicationArgs(fixture, created.productId);
			const staleArgs = [
				{ ...args, expectedDraftRevisionId: null },
				{
					...args,
					expectedPublishedRevisionId: operation === "publishDraft"
						? created.revisionId
						: null,
				},
				{ ...args, expectedUpdatedAt: args.expectedUpdatedAt - 1 },
			];
			const before = await product(fixture, created.productId);
			const beforeCounts = await storedCounts(fixture);
			for (const stale of staleArgs) {
				await expect(fixture.adminA.mutation(mutation, stale)).rejects.toThrow(
					/Catalog publication conflict: reload before retrying/,
				);
				expect(await product(fixture, created.productId)).toEqual(before);
				expect(await storedCounts(fixture)).toEqual(beforeCounts);
			}

			await fixture.adminA.mutation(mutation, args);
			const committed = await product(fixture, created.productId);
			const committedCounts = await storedCounts(fixture);
			await expect(fixture.adminA.mutation(mutation, args)).rejects.toThrow(
				/Catalog publication conflict: reload before retrying/,
			);
			expect(await product(fixture, created.productId)).toEqual(committed);
			expect(await storedCounts(fixture)).toEqual(committedCounts);
		},
	);

	test("fails safely when a monotonic server publication timestamp cannot be represented", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"timestamp-overflow",
			graphDraft("postcard", fixture, "timestamp-overflow"),
		);
		await fixture.t.run(async (ctx) => {
			await ctx.db.patch(created.productId, { updatedAt: Number.MAX_SAFE_INTEGER });
		});
		const args = await publicationArgs(fixture, created.productId);
		const before = await product(fixture, created.productId);
		await expect(
			fixture.adminA.mutation(api.catalogProductGraphs.publishDraft, args),
		).rejects.toThrow(/Catalog publication conflict: reload before retrying/);
		expect(await product(fixture, created.productId)).toEqual(before);
	});

	test("rejects incomplete publication and tenant-wide duplicate slug ownership", async () => {
		const fixture = await setup(modules);
		const incomplete = graphDraft("digital_download", fixture, "incomplete");
		incomplete.title = undefined;
		const missing = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"incomplete",
			incomplete,
		);
		await expect(fixture.adminA.mutation(
			api.catalogProductGraphs.publishDraft,
			await publicationArgs(fixture, missing.productId),
		)).rejects.toThrow(/title is required/i);
		expect((await product(fixture, missing.productId)).publishedRevisionId).toBeUndefined();

		const owned = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"owned-slug",
			graphDraft("merchandise", fixture, "owned-slug"),
		);
		await fixture.t.run(async (ctx) => {
			await ctx.db.insert("catalogProducts", {
				siteUrl: SITE_A.siteUrl,
				productKey: "duplicate-v1-owner",
				productKind: "print",
				slug: "owned-slug",
				createdAt: 1,
				createdBy: "fixture",
				updatedAt: 1,
				updatedBy: "fixture",
			});
		});
		await expect(fixture.adminA.mutation(
			api.catalogProductGraphs.publishDraft,
			await publicationArgs(fixture, owned.productId),
		)).rejects.toThrow(/unique\(\) query returned more than one|ownership mismatch/i);
		expect((await product(fixture, owned.productId)).publishedRevisionId).toBeUndefined();
	});

	test("public reads are bounded, ordered, safe, and pinned to the published revision", async () => {
		const fixture = await setup(modules);
		const created: Array<Awaited<ReturnType<typeof createGraph>>> = [];
		for (let index = 0; index < 33; index += 1) {
			const slug = `launch-${String(index).padStart(2, "0")}`;
			const draft = graphDraft("postcard", fixture, slug);
			draft.shopPlacement = index === 1
				? { featured: true }
				: index === 2
				? { featured: true, orderRank: "b" }
				: index === 3
				? { featured: true, orderRank: "a" }
				: index === 0
				? { featured: false }
				: { featured: false, orderRank: `z-${String(index).padStart(2, "0")}` };
			const value = await createGraph(fixture.adminA, SITE_A.siteUrl, slug, draft);
			await fixture.adminA.mutation(
				api.catalogProductGraphs.publishDraft,
				await publicationArgs(fixture, value.productId),
			);
			created.push(value);
		}
		const current = created[3];
		if (!current) throw new Error("Current-pointer fixture is missing");
		const replacement = graphDraft("postcard", fixture, "launch-03");
		replacement.title = "Private replacement title";
		await saveGraph(
			fixture.adminA,
			current.productId,
			replacement,
			current.revisionId,
		);

		const list = await fixture.t.query(api.catalogProductGraphs.listPublished, {
			siteUrl: SITE_A.siteUrl,
		});
		expect(list).toHaveLength(33);
		expect(list.slice(0, 3).map(({ slug }) => slug)).toEqual([
			"launch-03",
			"launch-02",
			"launch-01",
		]);
		expect(list.at(-1)?.slug).toBe("launch-00");
		const detail = await fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: "launch-03",
		});
		expect(detail).toMatchObject({
			title: "Product launch-03",
			revisionId: current.revisionId,
		});
		expect(JSON.stringify(detail)).not.toContain("Private replacement title");
		const forbidden = /productkey|filename|objectkey|sha256|checksum|private|provider|cost|actor|createdby|updatedby|printsource|paidfile|fulfillment/i;
		expect(allKeys(list).filter((key) => forbidden.test(key))).toEqual([]);

		const unpublished = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"unpublished-null",
			graphDraft("tapestry", fixture, "unpublished-null"),
		);
		const v1 = await fixture.adminA.mutation(api.catalogProducts.createDraft, {
			siteUrl: SITE_A.siteUrl,
			productKey: "legacy-null",
			draft: v1Draft("legacy-null"),
		});
		expect(unpublished.productId).toBeTruthy();
		expect(v1.productId).toBeTruthy();
		for (const slug of ["missing", " Not Exact ", "unpublished-null", "legacy-null"]) {
			expect(await fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
				siteUrl: SITE_A.siteUrl,
				slug,
			})).toBeNull();
		}
	});

	test("public list and detail hide a kind disabled after publication", async () => {
		const fixture = await setup(modules);
		const disabled = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"disabled-print",
			graphDraft("print", fixture, "disabled-print"),
		);
		const enabled = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"enabled-postcard",
			graphDraft("postcard", fixture, "enabled-postcard"),
		);
		for (const created of [disabled, enabled]) {
			await fixture.adminA.mutation(
				api.catalogProductGraphs.publishDraft,
				await publicationArgs(fixture, created.productId),
			);
		}
		await fixture.t.run(async (ctx) => {
			const client = await ctx.db.query("platformClients")
				.withIndex("by_siteUrl", (query) => query.eq("siteUrl", SITE_A.siteUrl))
				.unique();
			if (!client) throw new Error("Client fixture is missing");
			await ctx.db.patch(client._id, { catalogProductKinds: ["postcard"] });
			await ctx.db.patch(disabled.revisionId, { variantCount: 2 });
		});
		await insertBareProducts(fixture, 41, () => ({ productKind: "print" }));

		await expect(fixture.t.query(api.catalogProductGraphs.listPublished, {
			siteUrl: SITE_A.siteUrl,
		})).resolves.toMatchObject([{ slug: "enabled-postcard" }]);
		await expect(fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: "disabled-print",
		})).resolves.toBeNull();
		await expect(fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: "enabled-postcard",
		})).resolves.toMatchObject({ productKind: "postcard" });
	});

	test.each(["missing", "malformed"] as const)(
		"public list and detail fail closed with one generic error for a %s catalog policy",
		async (policy) => {
			const fixture = await setup(modules);
			await fixture.t.run(async (ctx) => {
				const client = await ctx.db.query("platformClients")
					.withIndex("by_siteUrl", (query) => query.eq("siteUrl", SITE_A.siteUrl))
					.unique();
				if (!client) throw new Error("Client fixture is missing");
				await ctx.db.patch(client._id, {
					catalogProductKinds: policy === "missing"
						? undefined
						: ["postcard", "postcard"],
				});
			});
			const reads = [
				fixture.t.query(api.catalogProductGraphs.listPublished, {
					siteUrl: SITE_A.siteUrl,
				}),
				fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
					siteUrl: SITE_A.siteUrl,
					slug: "anything",
				}),
			];
			for (const read of reads) {
				await expect(read).rejects.toThrow(/Catalog public reads are unavailable/);
				await read.catch((error: unknown) => {
					const message = error instanceof Error ? error.message : String(error);
					expect(message).not.toMatch(/not configured|duplicate catalog|platformClients/i);
				});
			}
		},
	);

	test("public detail and list fail closed when the pointed graph is corrupt", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"corrupt-public",
			graphDraft("tapestry", fixture, "corrupt-public"),
		);
		await fixture.adminA.mutation(
			api.catalogProductGraphs.publishDraft,
			await publicationArgs(fixture, created.productId),
		);
		await fixture.t.run(async (ctx) => {
			await ctx.db.patch(created.revisionId, { variantCount: 2 });
		});
		await expect(fixture.t.query(api.catalogProductGraphs.getPublishedBySlug, {
			siteUrl: SITE_A.siteUrl,
			slug: "corrupt-public",
		})).rejects.toThrow(/count mismatch/i);
		await expect(fixture.t.query(api.catalogProductGraphs.listPublished, {
			siteUrl: SITE_A.siteUrl,
		})).rejects.toThrow(/count mismatch/i);
	});

	test("fails closed on independent per-kind scan overflow before graph loading", async () => {
		const fixture = await setup(modules);
		await insertBareProducts(fixture, 41);
		await expect(fixture.t.query(api.catalogProductGraphs.listPublished, {
			siteUrl: SITE_A.siteUrl,
		})).rejects.toThrow(/postcard scan limit exceeded/i);
	});

	test("fails closed on total publication overflow before graph fanout", async () => {
		const fixture = await setup(modules);
		const base = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"total-overflow-base",
			graphDraft("print", fixture, "total-overflow-base"),
		);
		await fixture.adminA.mutation(
			api.catalogProductGraphs.publishDraft,
			await publicationArgs(fixture, base.productId),
		);
		await insertBareProducts(fixture, 40, (index) => ({
			productKind: CATALOG_PRODUCT_KIND_ORDER[index % CATALOG_PRODUCT_KIND_ORDER.length],
			publishedRevisionId: base.revisionId,
			publishedAt: 1,
			publishedBy: "fixture",
		}));
		await expect(fixture.t.query(api.catalogProductGraphs.listPublished, {
			siteUrl: SITE_A.siteUrl,
		})).rejects.toThrow(/public product limit exceeded/i);
	});
});
