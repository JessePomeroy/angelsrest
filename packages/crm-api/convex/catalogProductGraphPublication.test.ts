/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { describe, expect, test } from "vitest";
import {
	createGraph,
	graphDraft,
	SITE_A,
	setup,
	workerAssetId,
} from "../test/catalogProductGraphFixtures";
import type { Id } from "./_generated/dataModel";
import {
	loadCatalogProductGraphV2Revision,
	projectCatalogProductGraphV2Public,
} from "./helpers/catalogProductGraphData";
import type { CatalogProductGraphV2Draft } from "./helpers/catalogProductGraphValidators";
import { CATALOG_PRODUCT_KIND_ORDER } from "./helpers/catalogProductPolicy";

const modules = import.meta.glob("./**/*.ts");
type Fixture = Awaited<ReturnType<typeof setup>>;

async function project(
	fixture: Fixture,
	productId: Id<"catalogProducts">,
	revisionId: Id<"catalogProductRevisions">,
) {
	return await fixture.t.run(async (ctx) => {
		const product = await ctx.db.get(productId);
		if (!product) throw new Error("Product fixture is missing");
		const graph = await loadCatalogProductGraphV2Revision(ctx, product, revisionId);
		if (!graph) throw new Error("Graph fixture is missing");
		return projectCatalogProductGraphV2Public(graph);
	});
}

function allKeys(value: unknown): string[] {
	if (Array.isArray(value)) return value.flatMap(allKeys);
	if (!value || typeof value !== "object") return [];
	return Object.entries(value).flatMap(([key, entry]) => [key, ...allKeys(entry)]);
}

function firstVariant(draft: CatalogProductGraphV2Draft) {
	const variant = draft.variants[0];
	if (!variant) throw new Error("Variant fixture is missing");
	return variant;
}

function removePrivateRelations(draft: CatalogProductGraphV2Draft) {
	if (draft.productKind === "print") draft.printSources = [];
	if (draft.productKind === "print_set") {
		draft.webMedia = draft.webMedia.filter(({ role }) => role !== "set_member");
		draft.printSources = [];
		draft.setMembers = [];
	}
	if (draft.productKind === "digital_download") draft.paidFile = undefined;
}

describe("catalog V2 publication projection", () => {
	test.each(CATALOG_PRODUCT_KIND_ORDER)("projects the complete public %s contract deterministically", async (kind) => {
		const fixture = await setup(modules);
		const draft = graphDraft(kind, fixture, `public-${kind}`);
		if (draft.productKind === "print") {
			draft.variants.push({ key: "disabled", order: 1, status: "disabled" });
		}
		if (draft.productKind === "tapestry") {
			draft.webMedia.push({ key: "social", order: 0, role: "social_share", assetId: fixture.webA2 });
		}
		const created = await createGraph(fixture.adminA, SITE_A.siteUrl, `public-${kind}`, draft);
		const first = await project(fixture, created.productId, created.revisionId);
		expect(await project(fixture, created.productId, created.revisionId)).toEqual(first);
		expect(first).toMatchObject({
			schemaVersion: 2,
			productId: created.productId,
			revisionId: created.revisionId,
			productKind: kind,
			title: `Product public-${kind.replace(/_/g, "-")}`,
			slug: `public-${kind.replace(/_/g, "-")}`,
			description: expect.any(String),
			seoDescription: expect.any(String),
			currency: "usd",
			saleAvailability: "available",
			shopPlacement: { featured: false, orderRank: `rank-public-${kind.replace(/_/g, "-")}` },
		});
		expect(first.variants).toHaveLength(1);
		expect(first.variants[0]).toEqual(expect.objectContaining({
			order: 0,
			materialOption: kind === "print" || kind === "print_set"
				? { slug: "archival-matte", label: "Archival Matte" }
				: null,
			sizeOption: kind === "print" || kind === "print_set"
				? { slug: "8x10", label: "8×10", widthInches: 8, heightInches: 10 }
				: null,
			retailPriceCents: expect.any(Number),
		}));
		expect(Number.isSafeInteger(first.variants[0]?.retailPriceCents)).toBe(true);
		expect(first.variants.some(({ key }) => key === "disabled")).toBe(false);
		expect(first.media.map(({ role }) => role)).toEqual(kind === "print"
			? ["primary", "gallery"]
			: kind === "print_set"
			? ["cover", "set_member", "set_member"]
			: kind === "tapestry"
			? ["gallery", "social_share"]
			: ["gallery"]);
		expect(first.media[0]?.asset).toEqual({
			assetId: workerAssetId("a", 1),
			source: { width: 3000, height: 2000 },
			derivatives: {
				thumb: { contentType: "image/webp", width: 320, height: 213 },
				card: { contentType: "image/webp", width: 768, height: 512 },
				display1280: { contentType: "image/webp", width: 1280, height: 853 },
				display2048: { contentType: "image/webp", width: 2048, height: 1365 },
				display2560: { contentType: "image/webp", width: 2560, height: 1707 },
			},
		});
		if (kind === "print" || kind === "print_set") expect(first).toHaveProperty("printOptions");
		else expect(first).not.toHaveProperty("printOptions");
		if (kind === "tapestry") {
			expect(first.media.find(({ role }) => role === "social_share")?.altText).toBeNull();
		}
	});

	test.each([
		["title", "title", (draft: CatalogProductGraphV2Draft) => { draft.title = undefined; }],
		["slug", "slug", (draft: CatalogProductGraphV2Draft) => { draft.slug = undefined; }],
		["display media", "display media", (draft: CatalogProductGraphV2Draft) => { draft.webMedia = []; }],
		["display alt text", "alternative text", (draft: CatalogProductGraphV2Draft) => {
			draft.webMedia[0]!.altText = undefined;
		}],
		["enabled price", "retail price", (draft: CatalogProductGraphV2Draft) => {
			firstVariant(draft).retailPriceCents = undefined;
		}],
		["enabled variant", "enabled variant", (draft: CatalogProductGraphV2Draft) => {
			firstVariant(draft).status = "disabled";
		}],
		["print options", "material and size", (draft: CatalogProductGraphV2Draft) => {
			firstVariant(draft).materialOptionKey = undefined;
		}],
	] as const)("rejects a publishable graph missing %s", async (label, message, mutate) => {
		const fixture = await setup(modules);
		const key = `missing-${label.replaceAll(" ", "-")}`;
		const draft: CatalogProductGraphV2Draft = graphDraft("print", fixture, key);
		mutate(draft);
		if (["title", "slug", "display media", "display alt text"].includes(label)) {
			draft.saleAvailability = "unavailable";
			firstVariant(draft).status = "disabled";
		}
		const created = await createGraph(fixture.adminA, SITE_A.siteUrl, key, draft);
		await expect(project(fixture, created.productId, created.revisionId)).rejects.toThrow(new RegExp(message, "i"));
	});

	test.each([
		["print", "print source"],
		["print_set", "non-empty print set"],
		["digital_download", "paid file"],
	] as const)("requires private relations only for available %s products", async (kind, message) => {
		const fixture = await setup(modules);
		const available = graphDraft(kind, fixture, `available-${kind}`);
		removePrivateRelations(available);
		const rejected = await createGraph(fixture.adminA, SITE_A.siteUrl, `available-${kind}`, available);
		await expect(project(fixture, rejected.productId, rejected.revisionId)).rejects.toThrow(new RegExp(message, "i"));

		const unavailable = graphDraft(kind, fixture, `unavailable-${kind}`);
		unavailable.saleAvailability = "unavailable";
		unavailable.variants.forEach((variant) => { variant.status = "disabled"; });
		removePrivateRelations(unavailable);
		expect(unavailable.variants.every(({ status }) => status === "disabled")).toBe(true);
		if (unavailable.productKind === "digital_download") expect(unavailable.paidFile).toBeUndefined();
		else expect(unavailable.printSources).toEqual([]);
		if (unavailable.productKind === "print_set") {
			expect(unavailable.setMembers).toEqual([]);
			expect(unavailable.webMedia.some(({ role }) => role === "set_member")).toBe(false);
		}
		const created = await createGraph(fixture.adminA, SITE_A.siteUrl, `unavailable-${kind}`, unavailable);
		const publicValue = await project(fixture, created.productId, created.revisionId);
		expect(publicValue).toMatchObject({ saleAvailability: "unavailable", variants: [] });
	});

	test("still requires a print-set cover", async () => {
		const fixture = await setup(modules);
		const draft = graphDraft("print_set", fixture, "missing-set-cover");
		draft.webMedia = draft.webMedia.filter(({ role }) => role !== "cover");
		const created = await createGraph(fixture.adminA, SITE_A.siteUrl, "missing-set-cover", draft);
		await expect(project(fixture, created.productId, created.revisionId)).rejects.toThrow(/display media/i);
	});

	test.each(["print", "print_set"] as const)("validates the enabled %s material-size support pair", async (kind) => {
		const fixture = await setup(modules);
		const valid = graphDraft(kind, fixture, `valid-canvas-${kind}`);
		firstVariant(valid).materialOptionKey = "canvas-black-rolled";
		const validCreated = await createGraph(fixture.adminA, SITE_A.siteUrl, `valid-canvas-${kind}`, valid);
		expect((await project(fixture, validCreated.productId, validCreated.revisionId)).variants[0]).toMatchObject({
			materialOption: { slug: "canvas-black-rolled", label: "Canvas Black — rolled" },
			sizeOption: { slug: "8x10" },
		});

		const invalid = graphDraft(kind, fixture, `invalid-canvas-${kind}`);
		firstVariant(invalid).materialOptionKey = "canvas-black-rolled";
		firstVariant(invalid).sizeOptionKey = "4x6";
		const invalidCreated = await createGraph(fixture.adminA, SITE_A.siteUrl, `invalid-canvas-${kind}`, invalid);
		await expect(project(fixture, invalidCreated.productId, invalidCreated.revisionId)).rejects.toThrow(/supported material and size pair/i);
	});

	test("has a focused forbidden public shape", async () => {
		const fixture = await setup(modules);
		const importKey = "sanity.catalog.source-id";
		const created = await createGraph(fixture.adminA, SITE_A.siteUrl, importKey,
			graphDraft("print_set", fixture, "neutral-public-product"));
		const publicValue = await project(fixture, created.productId, created.revisionId);
		const forbidden = new RegExp([
			"productkey", "master", "filename", "objectkey", "sha256", "checksum", "private",
			"provider", "cost", "actor", "createdat", "createdby", "updatedat", "updatedby",
			"verifiedat", "verifiedby", "credential", "grant", "capabilit", "receipt",
			"printsource", "paidfile", "fulfillment",
		].join("|"), "i");
		expect(allKeys(publicValue).filter((key) => forbidden.test(key))).toEqual([]);
		expect(publicValue).not.toHaveProperty("productKey");
		expect(publicValue.slug).toBe("neutral-public-product");
		expect(JSON.stringify(publicValue)).not.toContain(importKey);
		expect(JSON.stringify(publicValue)).not.toContain("sites/site-a.example/");
		expect(JSON.stringify(publicValue)).not.toContain(fixture.printA);
	});
});
