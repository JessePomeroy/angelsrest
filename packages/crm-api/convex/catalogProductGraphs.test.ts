/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { describe, expect, test } from "vitest";
import { api } from "./_generated/api";
import * as catalogProductGraphsModule from "./catalogProductGraphs";
import * as catalogProductsModule from "./catalogProducts";
import type { CatalogProductKind } from "./helpers/catalogProductValidators";
import {
	SITE_A,
	SITE_B,
	createGraph,
	graphDraft,
	graphRows,
	saveGraph,
	setup,
	slugFor,
	storedCounts,
	v1Draft,
} from "../test/catalogProductGraphFixtures";

const modules = import.meta.glob("./**/*.ts");

describe("dormant private catalog product graph V2", () => {
	test("round-trips every product kind and lists only the requested kind", async () => {
		const fixture = await setup(modules);
		const kinds: CatalogProductKind[] = [
			"print",
			"print_set",
			"postcard",
			"tapestry",
			"digital_download",
			"merchandise",
		];
		for (const kind of kinds) {
			const draft = graphDraft(kind, fixture, kind);
			const expectedSlug = slugFor(kind);
			const created = await createGraph(fixture.adminA, SITE_A.siteUrl, `product-${kind}`, draft);
			const editor = await fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
				productId: created.productId,
			});
			expect(editor).toMatchObject({
				productId: created.productId,
				productKey: `product-${kind}`,
				productKind: kind,
				graphVersion: 2,
				slug: expectedSlug,
				draft: {
					revisionId: created.revisionId,
					schemaVersion: 2,
					productKind: kind,
					draft: { productKind: kind, slug: expectedSlug },
				},
				published: null,
				publishedAt: null,
			});
			const listed = await fixture.adminA.query(api.catalogProductGraphs.listForEditor, {
				siteUrl: SITE_A.siteUrl,
				productKind: kind,
			});
			expect(listed).toEqual([
				expect.objectContaining({
					productId: created.productId,
					productKind: kind,
					graphVersion: 2,
				}),
			]);
		}
		const safe = JSON.stringify(await fixture.adminA.query(
			api.catalogProductGraphs.getEditorState,
			{ productId: (await fixture.adminA.query(api.catalogProductGraphs.listForEditor, {
				siteUrl: SITE_A.siteUrl,
				productKind: "print_set",
			}))[0]!.productId },
		));
		expect(safe).not.toMatch(/privateObjectKey|sha256|provenance|verifiedBy|createdBy|master\.webp/);
	});

	test("requires authentication and stored tenant membership for every graph operation", async () => {
		const fixture = await setup(modules);
		const draft = graphDraft("print", fixture, "auth-print");
		await expect(fixture.t.mutation(api.catalogProductGraphs.createDraft, {
			siteUrl: SITE_A.siteUrl,
			productKey: "anonymous",
			draft,
		})).rejects.toThrow(/not authenticated/i);
		await expect(createGraph(fixture.adminB, SITE_A.siteUrl, "foreign", draft))
			.rejects.toThrow(/not authorized/i);
		const created = await createGraph(fixture.adminA, SITE_A.siteUrl, "owned", draft);
		await expect(fixture.t.query(api.catalogProductGraphs.getEditorState, {
			productId: created.productId,
		})).rejects.toThrow(/not authenticated/i);
		await expect(fixture.adminB.query(api.catalogProductGraphs.getEditorState, {
			productId: created.productId,
		})).rejects.toThrow(/not authorized/i);
		await expect(saveGraph(fixture.adminB, created.productId, draft, created.revisionId))
			.rejects.toThrow(/not authorized/i);
		await expect(fixture.adminB.mutation(api.catalogProductGraphs.discardDraft, {
			productId: created.productId,
			draftRevisionId: created.revisionId,
		})).rejects.toThrow(/not authorized/i);
		await expect(fixture.adminB.query(api.catalogProductGraphs.listForEditor, {
			siteUrl: SITE_A.siteUrl,
			productKind: "print",
		})).rejects.toThrow(/not authorized/i);
	});

	test("deduplicates exact create and save retries without writing another row", async () => {
		const fixture = await setup(modules);
		const firstDraft = graphDraft("print_set", fixture, "retry-set");
		const created = await createGraph(fixture.adminA, SITE_A.siteUrl, "retry-set", firstDraft);
		const afterCreate = await storedCounts(fixture);
		expect(await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"retry-set",
			firstDraft,
		)).toEqual(created);
		expect(await storedCounts(fixture)).toEqual(afterCreate);

		const changed = { ...firstDraft, title: "Changed once" };
		const saved = await saveGraph(
			fixture.adminA,
			created.productId,
			changed,
			created.revisionId,
		);
		const afterSave = await storedCounts(fixture);
		expect(await saveGraph(
			fixture.adminA,
			created.productId,
			changed,
			created.revisionId,
		)).toEqual(saved);
		expect(await storedCounts(fixture)).toEqual(afterSave);
	});

	test("keeps old graphs immutable and rejects an optimistic write from a stale pointer", async () => {
		const fixture = await setup(modules);
		const initial = graphDraft("print", fixture, "immutable-print");
		const created = await createGraph(fixture.adminA, SITE_A.siteUrl, "immutable-print", initial);
		const before = await graphRows(fixture, created.revisionId);
		const saved = await saveGraph(
			fixture.adminA,
			created.productId,
			{ ...initial, title: "Replacement graph" },
			created.revisionId,
		);
		expect(saved.revisionId).not.toBe(created.revisionId);
		expect(await graphRows(fixture, created.revisionId)).toEqual(before);
		const counts = await storedCounts(fixture);
		await expect(saveGraph(
			fixture.adminA,
			created.productId,
			{ ...initial, title: "Stale overwrite" },
			created.revisionId,
		)).rejects.toThrow(/conflict/i);
		expect(await storedCounts(fixture)).toEqual(counts);
	});

	test("discards only the active pointer and makes an exact discard replay harmless", async () => {
		const fixture = await setup(modules);
		const draft = graphDraft("digital_download", fixture, "discard-download");
		const created = await createGraph(fixture.adminA, SITE_A.siteUrl, "discard-download", draft);
		const before = await graphRows(fixture, created.revisionId);
		const args = { productId: created.productId, draftRevisionId: created.revisionId };
		expect(await fixture.adminA.mutation(api.catalogProductGraphs.discardDraft, args))
			.toEqual({ productId: created.productId, draftRevisionId: null });
		expect(await fixture.adminA.mutation(api.catalogProductGraphs.discardDraft, args))
			.toEqual({ productId: created.productId, draftRevisionId: null });
		expect(await graphRows(fixture, created.revisionId)).toEqual(before);
		expect(await fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
			productId: created.productId,
		})).toMatchObject({ slug: null, draft: null, published: null });
		const resumed = await saveGraph(
			fixture.adminA,
			created.productId,
			{ ...draft, slug: "resumed-download", title: "Resumed" },
		);
		expect(resumed.revisionId).not.toBe(created.revisionId);
	});

	test("keeps V1 and V2 APIs, indexes, and revision contracts isolated", async () => {
		const fixture = await setup(modules);
		expect(Object.keys(catalogProductsModule).sort()).toEqual([
			"createDraft",
			"discardDraft",
			"getEditorState",
			"listForEditor",
			"saveDraft",
		]);
		expect(Object.keys(catalogProductGraphsModule).sort()).toEqual([
			"createDraft",
			"discardDraft",
			"getEditorState",
			"listForEditor",
			"saveDraft",
		]);
		const v1 = await fixture.adminA.mutation(api.catalogProducts.createDraft, {
			siteUrl: SITE_A.siteUrl,
			productKey: "v1-print",
			draft: v1Draft("v1-print"),
		});
		const v2 = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"v2-print",
			graphDraft("print", fixture, "v2-print"),
		);
		await expect(fixture.adminA.query(api.catalogProducts.getEditorState, {
			productId: v2.productId,
		})).rejects.toThrow(/not a single print/i);
		await expect(fixture.adminA.query(api.catalogProductGraphs.getEditorState, {
			productId: v1.productId,
		})).rejects.toThrow(/not a v2 graph product/i);
		expect((await fixture.adminA.query(api.catalogProducts.listForEditor, {
			siteUrl: SITE_A.siteUrl,
		})).map(({ productId }) => productId)).toEqual([v1.productId]);
		expect((await fixture.adminA.query(api.catalogProductGraphs.listForEditor, {
			siteUrl: SITE_A.siteUrl,
			productKind: "print",
		})).map(({ productId }) => productId)).toEqual([v2.productId]);
		const stored = await fixture.t.run(async (ctx) => ({
			v1Product: await ctx.db.get(v1.productId),
			v2Product: await ctx.db.get(v2.productId),
			v1Revision: await ctx.db.get(v1.revisionId),
			v2Revision: await ctx.db.get(v2.revisionId),
		}));
		expect(stored.v1Product?.graphVersion).toBeUndefined();
		expect(stored.v2Product?.graphVersion).toBe(2);
		expect(stored.v1Revision?.schemaVersion).toBe(1);
		expect(stored.v2Revision?.schemaVersion).toBe(2);
		for (const product of [stored.v1Product, stored.v2Product]) {
			expect(product?.publishedRevisionId).toBeUndefined();
			expect(product?.publishedAt).toBeUndefined();
			expect(product?.publishedBy).toBeUndefined();
		}
	});

	test("enforces product keys and slugs across versions and kinds within one tenant", async () => {
		const fixture = await setup(modules);
		await fixture.adminA.mutation(api.catalogProducts.createDraft, {
			siteUrl: SITE_A.siteUrl,
			productKey: "v1-owned-key",
			draft: v1Draft("v1-owned-slug"),
		});
		await expect(createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"v1-owned-key",
			graphDraft("tapestry", fixture, "different-slug"),
		)).rejects.toThrow(/not a v2 graph product|already exists/i);
		await expect(createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"different-v2-key",
			graphDraft("tapestry", fixture, "v1-owned-slug"),
		)).rejects.toThrow(/slug.*already exists/i);

		await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"v2-owned-key",
			graphDraft("postcard", fixture, "v2-owned-slug"),
		);
		await expect(fixture.adminA.mutation(api.catalogProducts.createDraft, {
			siteUrl: SITE_A.siteUrl,
			productKey: "v2-owned-key",
			draft: v1Draft("another-v1-slug"),
		})).rejects.toThrow(/not a single print|already exists/i);
		await expect(createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"different-kind-key",
			graphDraft("merchandise", fixture, "v2-owned-slug"),
		)).rejects.toThrow(/slug.*already exists/i);

		const crossTenant = graphDraft("postcard", {
			...fixture,
			webA: fixture.webB,
			webA2: fixture.webB,
			printA: fixture.printB,
			printA2: fixture.printB,
			paidA: fixture.paidB,
		}, "v2-owned-slug");
		expect(await createGraph(
			fixture.adminB,
			SITE_B.siteUrl,
			"v2-owned-key",
			crossTenant,
		)).toMatchObject({ productId: expect.any(String) });
	});

});
