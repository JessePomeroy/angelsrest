/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { describe, expect, test } from "vitest";
import { api, internal } from "./_generated/api";
import {
	SITE_A,
	createGraph,
	graphDraft,
	saveGraph,
	setup,
	storedCounts,
	v1Draft,
} from "../test/catalogProductGraphFixtures";

const modules = import.meta.glob("./**/*.ts");

function printAsset(
	assetId: string,
	assetKey: string,
	createdAt: number,
) {
	return {
		kind: "print_source",
		assetId,
		status: "verified",
		originalFilename: `${assetKey}.jpg`,
		mimeType: "image/jpeg",
		sizeBytes: 25_000_000,
		widthPixels: 8000,
		heightPixels: 6000,
		createdAt,
	};
}

function paidAsset(
	assetId: string,
	assetKey: string,
	createdAt: number,
	version: string,
) {
	return {
		kind: "paid_digital_file",
		assetId,
		status: "verified",
		originalFilename: `${assetKey}.zip`,
		mimeType: "application/zip",
		sizeBytes: 10_000_000,
		version,
		createdAt,
	};
}

function expectNoPrivateAssetMetadata(value: unknown) {
	expect(JSON.stringify(value)).not.toMatch(
		/siteUrl|privateObjectKey|assetKey|sha256|provenance|createdBy|verifiedAt|verifiedBy|capability|receipt|grant/i,
	);
}

describe("catalogProductGraphs.listDraftPrivateAssetCandidates", () => {
	test("returns a newest-first, tenant-owned, paginated safe print-source list", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"candidate-print",
			graphDraft("print", fixture, "candidate-print"),
		);
		const counts = await storedCounts(fixture);
		const args = {
			productId: created.productId,
			expectedDraftRevisionId: created.revisionId,
			relation: { kind: "print_source" as const, relationKey: "master" },
		};

		const first = await fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			{ ...args, paginationOpts: { numItems: 2, cursor: null } },
		);
		expect(first).toEqual({
			productId: created.productId,
			draftRevisionId: created.revisionId,
			relation: {
				kind: "print_source",
				relationKey: "master",
				currentAsset: printAsset(fixture.printA, "print-a", 101),
			},
			page: [
				printAsset(fixture.printA3, "print-a-3", 103),
				printAsset(fixture.printA2, "print-a-2", 102),
			],
			isDone: false,
			continueCursor: expect.any(String),
			splitCursor: null,
			pageStatus: null,
		});
		expectNoPrivateAssetMetadata(first);
		expect(first.page.map(({ assetId }) => assetId)).not.toContain(fixture.printB);

		const second = await fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			{
				...args,
				paginationOpts: { numItems: 2, cursor: first.continueCursor },
			},
		);
		expect(second).toEqual({
			productId: created.productId,
			draftRevisionId: created.revisionId,
			relation: first.relation,
			page: [printAsset(fixture.printA, "print-a", 101)],
			isDone: true,
			continueCursor: expect.any(String),
			splitCursor: null,
			pageStatus: null,
		});
		expectNoPrivateAssetMetadata(second);
		expect(await storedCounts(fixture)).toEqual(counts);
	});

	test("proves one keyed print-set relation before listing compatible sources", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"candidate-print-set",
			graphDraft("print_set", fixture, "candidate-print-set"),
		);
		const counts = await storedCounts(fixture);

		const result = await fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			{
				productId: created.productId,
				expectedDraftRevisionId: created.revisionId,
				relation: {
					kind: "print_source",
					relationKey: "member-2-source",
				},
				paginationOpts: { numItems: 50, cursor: null },
			},
		);
		expect(result).toEqual({
			productId: created.productId,
			draftRevisionId: created.revisionId,
			relation: {
				kind: "print_source",
				relationKey: "member-2-source",
				currentAsset: printAsset(fixture.printA2, "print-a-2", 102),
			},
			page: [
				printAsset(fixture.printA3, "print-a-3", 103),
				printAsset(fixture.printA2, "print-a-2", 102),
				printAsset(fixture.printA, "print-a", 101),
			],
			isDone: true,
			continueCursor: expect.any(String),
			splitCursor: null,
			pageStatus: null,
		});
		expectNoPrivateAssetMetadata(result);
		expect(await storedCounts(fixture)).toEqual(counts);
	});

	test("returns only safe paid-download candidates and preserves their server versions", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"candidate-download",
			graphDraft("digital_download", fixture, "candidate-download"),
		);
		const counts = await storedCounts(fixture);

		const result = await fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			{
				productId: created.productId,
				expectedDraftRevisionId: created.revisionId,
				relation: {
					kind: "paid_digital_file",
					relationKey: "download",
				},
				paginationOpts: { numItems: 50, cursor: null },
			},
		);
		expect(result).toEqual({
			productId: created.productId,
			draftRevisionId: created.revisionId,
			relation: {
				kind: "paid_digital_file",
				relationKey: "download",
				currentAsset: paidAsset(fixture.paidA, "paid-a", 101, "v1"),
			},
			page: [
				paidAsset(fixture.paidA2, "paid-a-2", 102, "v2"),
				paidAsset(fixture.paidA, "paid-a", 101, "v1"),
			],
			isDone: true,
			continueCursor: expect.any(String),
			splitCursor: null,
			pageStatus: null,
		});
		expect(result.page.map(({ assetId }) => assetId)).not.toContain(fixture.paidB);
		expectNoPrivateAssetMetadata(result);
		expect(await storedCounts(fixture)).toEqual(counts);
	});

	test("requires authentication, stored tenant membership, and the product-kind policy", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"candidate-auth",
			graphDraft("print", fixture, "candidate-auth"),
		);
		const args = {
			productId: created.productId,
			expectedDraftRevisionId: created.revisionId,
			relation: { kind: "print_source" as const, relationKey: "master" },
			paginationOpts: { numItems: 10, cursor: null },
		};
		const counts = await storedCounts(fixture);

		await expect(fixture.t.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			args,
		)).rejects.toThrow(/not authenticated/i);
		await expect(fixture.adminB.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			args,
		)).rejects.toThrow(/not authorized/i);

		await fixture.t.mutation(internal.platform.setCatalogProductKinds, {
			siteUrl: SITE_A.siteUrl,
			catalogProductKinds: ["digital_download"],
		});
		await expect(fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			args,
		)).rejects.toThrow(/catalog print products are not enabled/i);
		expect(await storedCounts(fixture)).toEqual(counts);
	});

	test("rejects V1, stale, and discarded draft boundaries without writing rows", async () => {
		const fixture = await setup(modules);
		const v1 = await fixture.adminA.mutation(api.catalogProducts.createDraft, {
			siteUrl: SITE_A.siteUrl,
			productKey: "candidate-v1",
			draft: v1Draft("candidate-v1"),
		});
		await expect(fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			{
				productId: v1.productId,
				expectedDraftRevisionId: v1.revisionId,
				relation: { kind: "print_source", relationKey: "master" },
				paginationOpts: { numItems: 10, cursor: null },
			},
		)).rejects.toThrow(/not a v2 graph product/i);

		const initial = graphDraft("print", fixture, "candidate-lifecycle");
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"candidate-lifecycle",
			initial,
		);
		const saved = await saveGraph(
			fixture.adminA,
			created.productId,
			{ ...initial, title: "New active draft" },
			created.revisionId,
		);
		const staleArgs = {
			productId: created.productId,
			expectedDraftRevisionId: created.revisionId,
			relation: { kind: "print_source" as const, relationKey: "master" },
			paginationOpts: { numItems: 10, cursor: null },
		};
		const counts = await storedCounts(fixture);
		await expect(fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			staleArgs,
		)).rejects.toThrow(/conflict/i);
		expect(await storedCounts(fixture)).toEqual(counts);

		await fixture.adminA.mutation(api.catalogProductGraphs.discardDraft, {
			productId: created.productId,
			draftRevisionId: saved.revisionId,
		});
		const discardedCounts = await storedCounts(fixture);
		await expect(fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			{
				...staleArgs,
				expectedDraftRevisionId: saved.revisionId,
			},
		)).rejects.toThrow(/require(?:s)? an active draft/i);
		expect(await storedCounts(fixture)).toEqual(discardedCounts);
	});

	test("rejects incompatible or missing relation keys without writing rows", async () => {
		const fixture = await setup(modules);
		const print = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"candidate-boundary-print",
			graphDraft("print", fixture, "candidate-boundary-print"),
		);
		const download = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"candidate-boundary-download",
			graphDraft("digital_download", fixture, "candidate-boundary-download"),
		);
		const page = { numItems: 10, cursor: null };
		const counts = await storedCounts(fixture);

		await expect(fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			{
				productId: print.productId,
				expectedDraftRevisionId: print.revisionId,
				relation: { kind: "paid_digital_file", relationKey: "download" },
				paginationOpts: page,
			},
		)).rejects.toThrow(/digital-download product/i);
		await expect(fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			{
				productId: download.productId,
				expectedDraftRevisionId: download.revisionId,
				relation: { kind: "print_source", relationKey: "master" },
				paginationOpts: page,
			},
		)).rejects.toThrow(/print-family product/i);
		await expect(fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			{
				productId: print.productId,
				expectedDraftRevisionId: print.revisionId,
				relation: { kind: "print_source", relationKey: "missing" },
				paginationOpts: page,
			},
		)).rejects.toThrow(/relation key must resolve exactly once/i);
		await expect(fixture.adminA.query(
			api.catalogProductGraphs.listDraftPrivateAssetCandidates,
			{
				productId: download.productId,
				expectedDraftRevisionId: download.revisionId,
				relation: { kind: "paid_digital_file", relationKey: "missing" },
				paginationOpts: page,
			},
		)).rejects.toThrow(/relation key must resolve exactly once/i);
		expect(await storedCounts(fixture)).toEqual(counts);
	});

	test("rejects zero, fractional, and oversized candidate page requests", async () => {
		const fixture = await setup(modules);
		const created = await createGraph(
			fixture.adminA,
			SITE_A.siteUrl,
			"candidate-page-bounds",
			graphDraft("print", fixture, "candidate-page-bounds"),
		);
		const counts = await storedCounts(fixture);

		for (const numItems of [0, 1.5, 51]) {
			await expect(fixture.adminA.query(
				api.catalogProductGraphs.listDraftPrivateAssetCandidates,
				{
					productId: created.productId,
					expectedDraftRevisionId: created.revisionId,
					relation: { kind: "print_source", relationKey: "master" },
					paginationOpts: { numItems, cursor: null },
				},
			)).rejects.toThrow(/page|pagination|numItems/i);
		}
		expect(await storedCounts(fixture)).toEqual(counts);
	});
});
