import type { Id } from "./_generated/dataModel";
import { describe, expect, test } from "vitest";
import { createSanityCatalogImportManifest } from "./helpers/sanityCatalogImport";
import {
	assertSanityCatalogV2GraphPlan,
	createSanityCatalogV2GraphPlan,
} from "./helpers/sanityCatalogGraphPlan";
import {
	CREATED_AT,
	image,
	refreshChecksums,
	reversed,
	sourceFixture,
	targetsFor,
	UPDATED_AT,
} from "../test/sanityCatalogGraphPlanFixtures";

describe("Sanity catalog V2 graph plan", () => {
	test("maps all six target families into deterministic validated V2 graphs", async () => {
		const manifest = createSanityCatalogImportManifest(sourceFixture());
		const targets = targetsFor(manifest);
		const plan = await createSanityCatalogV2GraphPlan(manifest, targets);

		expect(plan).toMatchObject({ version: 1, graphVersion: 2, sourceManifestVersion: 1 });
		expect(plan.products.map(({ productKey }) => productKey)).toEqual([
			"sanity.catalog.digital-a",
			"sanity.catalog.merchandise-a",
			"sanity.catalog.postcard-a",
			"sanity.catalog.print-b",
			"sanity.catalog.set-a",
			"sanity.catalog.tapestry-z",
		]);
		expect(plan.products.map(({ draft }) => draft.productKind)).toEqual([
			"digital_download",
			"merchandise",
			"postcard",
			"print",
			"print_set",
			"tapestry",
		]);
		expect(plan.products.every(({ graphChecksum }) => /^[a-f0-9]{64}$/.test(graphChecksum)))
			.toBe(true);
		expect(plan.graphPlanChecksum).toMatch(/^[a-f0-9]{64}$/);
		// This pure candidate maps already-created targets. Asset revisions remain in the
		// source manifest until the later transfer/receipt plan can bind them to verified bytes.
		expect(JSON.stringify(plan)).not.toContain("sourceAssetRevision");

		const print = plan.products.find(({ draft }) => draft.productKind === "print");
		expect(print).toMatchObject({
			sourceRevision: "revision-print-b",
			sourceCreatedAt: CREATED_AT,
			sourceUpdatedAt: UPDATED_AT,
			sourceRelations: {
				webMedia: [{ key: "primary", sourceAssetRef: "image-a-1200x800-jpg" }],
				printSources: [{ key: "primary", sourceAssetRef: "image-a-1200x800-jpg" }],
			},
			draft: {
				variants: [{ key: "print-variant", order: 0, retailPriceCents: 1_500 }],
				printSources: [{ key: "primary", order: 0, assetId: "print.asset.1" }],
			},
		});
		const set = plan.products.find(({ draft }) => draft.productKind === "print_set");
		expect(set?.draft).toMatchObject({
			webMedia: [
				{ key: "cover", role: "cover", order: 0 },
				{ key: "member-one", role: "set_member", order: 0 },
				{ key: "member-two", role: "set_member", order: 1 },
			],
			printSources: [
				{ key: "member-one", order: 0, assetId: "print.asset.1" },
				{ key: "member-two", order: 1, assetId: "print.asset.2" },
			],
			setMembers: [
				{
					key: "member-one",
					order: 0,
					mediaPlacementKey: "member-one",
					printSourceKey: "member-one",
				},
				{
					key: "member-two",
					order: 1,
					mediaPlacementKey: "member-two",
					printSourceKey: "member-two",
				},
			],
		});
		const digital = plan.products.find(
			({ draft }) => draft.productKind === "digital_download",
		);
		expect(digital?.draft).toMatchObject({
			variants: [{ key: "default", order: 0, retailPriceCents: 1_500 }],
			paidFile: { key: "download", assetId: "paid.asset.1", version: "1.0.0" },
		});
		for (const kind of ["postcard", "merchandise", "tapestry"] as const) {
			expect(plan.products.find(({ draft }) => draft.productKind === kind)?.draft)
				.toMatchObject({
					fulfillmentMode: "merchant_fulfilled",
					variants: [{ key: "default", order: 0, status: "enabled" }],
				});
		}
		await expect(assertSanityCatalogV2GraphPlan(plan)).resolves.toBe(plan);
	});

	test("is invariant to source and target-map insertion order", async () => {
		const manifest = createSanityCatalogImportManifest(sourceFixture());
		const targets = targetsFor(manifest);
		const reordered = structuredClone(manifest);
		reordered.products.reverse();

		const original = await createSanityCatalogV2GraphPlan(manifest, targets);
		const repeated = await createSanityCatalogV2GraphPlan(reordered, {
			webMedia: reversed(targets.webMedia),
			printSources: reversed(targets.printSources),
			paidFiles: reversed(targets.paidFiles),
		});

		expect(repeated).toEqual(original);
	});

	test("rejects blocked and hand-forged unsupported source manifests", async () => {
		const source = sourceFixture();
		source.general[0].category = "not-supported";
		const blocked = createSanityCatalogImportManifest(source);
		await expect(createSanityCatalogV2GraphPlan(blocked, targetsFor(blocked)))
			.rejects.toThrow("manifest is blocked");

		const unsupported = createSanityCatalogImportManifest(sourceFixture());
		unsupported.products[0].kind = "unsupported";
		unsupported.products[0].issues = [];
		unsupported.issues = [];
		await expect(createSanityCatalogV2GraphPlan(unsupported, targetsFor(unsupported)))
			.rejects.toThrow("unsupported product family");
	});

	test("rejects incomplete or kind-inapplicable source graphs", async () => {
		const setRelation = createSanityCatalogImportManifest(sourceFixture());
		const set = setRelation.products.find((product) => product.kind === "print_set");
		if (set?.printSetMembers?.[0]) {
			set.printSetMembers[0].sourceAssetRef = "image-c-1200x800-jpg";
		}
		await expect(createSanityCatalogV2GraphPlan(setRelation, targetsFor(setRelation)))
			.rejects.toThrow("invalid exact member relation");

		const noPaidFile = createSanityCatalogImportManifest(sourceFixture());
		const digital = noPaidFile.products.find(
			(product) => product.kind === "digital_download",
		);
		delete digital?.digitalFile;
		await expect(createSanityCatalogV2GraphPlan(noPaidFile, targetsFor(noPaidFile)))
			.rejects.toThrow("has no paid ZIP source");

		const noGallery = createSanityCatalogImportManifest(sourceFixture());
		const tapestry = noGallery.products.find((product) => product.kind === "tapestry");
		if (tapestry) tapestry.media = [];
		await expect(createSanityCatalogV2GraphPlan(noGallery, targetsFor(noGallery)))
			.rejects.toThrow("needs a valid display gallery");

		const collection = createSanityCatalogImportManifest(sourceFixture());
		collection.products[0].sourceCollectionId = "collection-a";
		await expect(createSanityCatalogV2GraphPlan(collection, targetsFor(collection)))
			.rejects.toThrow("unsupported collection");

		const wrongFields = createSanityCatalogImportManifest(sourceFixture());
		const fixed = wrongFields.products.find((product) => product.kind === "postcard");
		if (fixed) {
			fixed.printOptions = {
				borderOptionsEnabled: true,
				frameOptionsEnabled: false,
				framePriceMultiplierBasisPoints: 20_000,
			};
		}
		await expect(createSanityCatalogV2GraphPlan(wrongFields, targetsFor(wrongFields)))
			.rejects.toThrow("kind-inapplicable print fields");

		const fulfillment = createSanityCatalogImportManifest(sourceFixture());
		const print = fulfillment.products.find((product) => product.kind === "print");
		if (print) print.fulfillmentMode = "merchant_fulfilled";
		await expect(createSanityCatalogV2GraphPlan(fulfillment, targetsFor(fulfillment)))
			.rejects.toThrow("unsupported source contract");
	});

	test("rejects missing, extra, and duplicate target mappings", async () => {
		const manifest = createSanityCatalogImportManifest(sourceFixture());
		const targets = targetsFor(manifest);
		const [webFirst, webSecond] = targets.webMedia;
		const [printFirst, printSecond] = targets.printSources;

		await expect(createSanityCatalogV2GraphPlan(manifest, {
			...targets,
			webMedia: targets.webMedia.slice(1),
		})).rejects.toThrow("Web media mapping keys");
		await expect(createSanityCatalogV2GraphPlan(manifest, {
			...targets,
			printSources: [...targets.printSources, {
				sourceAssetRef: "image-extra-1200x800-jpg",
				printSourceAssetId: "print.asset.extra" as Id<"catalogPrintSourceAssets">,
			}],
		})).rejects.toThrow("Print source mapping keys");
		await expect(createSanityCatalogV2GraphPlan(manifest, {
			...targets,
			paidFiles: [],
		})).rejects.toThrow("Paid file mapping keys");
		await expect(createSanityCatalogV2GraphPlan(manifest, {
			...targets,
			webMedia: targets.webMedia.map((mapping) =>
				mapping === webSecond && webFirst
					? { ...mapping, mediaAssetId: webFirst.mediaAssetId }
					: mapping
			),
		})).rejects.toThrow("Web media target IDs must be unique");
		await expect(createSanityCatalogV2GraphPlan(manifest, {
			...targets,
			printSources: targets.printSources.map((mapping) =>
				mapping === printSecond && printFirst
					? { ...mapping, printSourceAssetId: printFirst.printSourceAssetId }
					: mapping
			),
		})).rejects.toThrow("Print source target IDs must be unique");
		await expect(createSanityCatalogV2GraphPlan(manifest, {
			...targets,
			webMedia: [...targets.webMedia, targets.webMedia[0]],
		})).rejects.toThrow("Web media source mappings must be unique");
	});

	test("runs target graph bounds instead of trusting the source adapter alone", async () => {
		const seo = sourceFixture();
		seo.general[0].seo = { description: "x".repeat(321) };
		const seoManifest = createSanityCatalogImportManifest(seo);
		await expect(createSanityCatalogV2GraphPlan(seoManifest, targetsFor(seoManifest)))
			.rejects.toThrow("SEO description");

		const rank = sourceFixture();
		rank.general[0].orderRank = "r".repeat(121);
		const rankManifest = createSanityCatalogImportManifest(rank);
		await expect(createSanityCatalogV2GraphPlan(rankManifest, targetsFor(rankManifest)))
			.rejects.toThrow("Shop order rank");

		const alt = sourceFixture();
		if (alt.general[0].images?.[0]) alt.general[0].images[0].alt = "a".repeat(1_001);
		const altManifest = createSanityCatalogImportManifest(alt);
		await expect(createSanityCatalogV2GraphPlan(altManifest, targetsFor(altManifest)))
			.rejects.toThrow("Web-media alt text");

		const media = sourceFixture();
		media.general[0].images = Array.from({ length: 51 }, (_, index) =>
			image(`gallery-${index}`, `image-gallery${index}-1200x800-jpg`)
		);
		const mediaManifest = createSanityCatalogImportManifest(media);
		await expect(createSanityCatalogV2GraphPlan(mediaManifest, targetsFor(mediaManifest)))
			.rejects.toThrow("web-media placement limit");

		const members = sourceFixture();
		members.sets[0].images = Array.from({ length: 21 }, (_, index) =>
			image(`member-${index}`, `image-member${index}-1200x800-jpg`)
		);
		const memberManifest = createSanityCatalogImportManifest(members);
		await expect(createSanityCatalogV2GraphPlan(memberManifest, targetsFor(memberManifest)))
			.rejects.toThrow("print-source limit");

		const paidVersion = sourceFixture();
		paidVersion.general[1].digitalFileVersion = "v".repeat(65);
		const paidManifest = createSanityCatalogImportManifest(paidVersion);
		await expect(createSanityCatalogV2GraphPlan(paidManifest, targetsFor(paidManifest)))
			.rejects.toThrow("paid source version is unsupported");
	});

	test("rejects paid-file source metadata that cannot enter the private ZIP boundary", async () => {
		for (const [field, value, error] of [
			["mimeType", "application/pdf", "application/zip"],
			["originalFilename", "theme-kit.pdf", ".zip filename"],
			["size", 10_000_000_001, "source size is unsupported"],
		] as const) {
			const source = sourceFixture();
			if (source.general[1].digitalFileAsset) {
				source.general[1].digitalFileAsset[field] = value;
			}
			const manifest = createSanityCatalogImportManifest(source);
			await expect(createSanityCatalogV2GraphPlan(manifest, targetsFor(manifest)))
				.rejects.toThrow(error);
		}
	});

	test("rejects incomplete migration graphs even after candidate checksums are recomputed", async () => {
		const manifest = createSanityCatalogImportManifest(sourceFixture());
		const complete = await createSanityCatalogV2GraphPlan(manifest, targetsFor(manifest));

		const printPlan = structuredClone(complete);
		const printIndex = printPlan.products.findIndex(
			({ draft }) => draft.productKind === "print",
		);
		const print = printPlan.products[printIndex].draft;
		if (print.productKind !== "print") throw new Error("Print fixture missing");
		print.webMedia = [];
		print.printSources = [];
		await refreshChecksums(printPlan, printIndex);
		await expect(assertSanityCatalogV2GraphPlan(printPlan))
			.rejects.toThrow("migration print graph is incomplete");

		const setPlan = structuredClone(complete);
		const setIndex = setPlan.products.findIndex(
			({ draft }) => draft.productKind === "print_set",
		);
		const set = setPlan.products[setIndex].draft;
		if (set.productKind !== "print_set") throw new Error("Print-set fixture missing");
		set.webMedia = set.webMedia.filter(({ role }) => role === "cover");
		set.printSources = [];
		set.setMembers = [];
		await refreshChecksums(setPlan, setIndex);
		await expect(assertSanityCatalogV2GraphPlan(setPlan))
			.rejects.toThrow("migration print-set graph is incomplete");

		const digitalPlan = structuredClone(complete);
		const digitalIndex = digitalPlan.products.findIndex(
			({ draft }) => draft.productKind === "digital_download",
		);
		const digital = digitalPlan.products[digitalIndex].draft;
		if (digital.productKind !== "digital_download") throw new Error("Digital fixture missing");
		delete digital.paidFile;
		await refreshChecksums(digitalPlan, digitalIndex);
		await expect(assertSanityCatalogV2GraphPlan(digitalPlan))
			.rejects.toThrow("digital graph has no paid file");

		const fixedPlan = structuredClone(complete);
		const fixedIndex = fixedPlan.products.findIndex(
			({ draft }) => draft.productKind === "tapestry",
		);
		fixedPlan.products[fixedIndex].draft.webMedia = [];
		await refreshChecksums(fixedPlan, fixedIndex);
		await expect(assertSanityCatalogV2GraphPlan(fixedPlan))
			.rejects.toThrow("display gallery is incomplete");
	});

	test("rejects recomputed Web/private source cross-wires", async () => {
		const manifest = createSanityCatalogImportManifest(sourceFixture());
		const complete = await createSanityCatalogV2GraphPlan(manifest, targetsFor(manifest));
		const alternate = complete.assetMappings.printSources.find(
			({ sourceAssetRef }) => sourceAssetRef === "image-c-1200x800-jpg",
		);
		if (!alternate) throw new Error("Alternate print-source fixture missing");

		const printPlan = structuredClone(complete);
		const printIndex = printPlan.products.findIndex(
			({ draft }) => draft.productKind === "print",
		);
		const printProduct = printPlan.products[printIndex];
		if (printProduct.draft.productKind !== "print") throw new Error("Print fixture missing");
		printProduct.draft.printSources[0].assetId = alternate.printSourceAssetId;
		printProduct.sourceRelations.printSources[0].sourceAssetRef = alternate.sourceAssetRef;
		await refreshChecksums(printPlan, printIndex);
		await expect(assertSanityCatalogV2GraphPlan(printPlan))
			.rejects.toThrow("print Web and private source provenance do not match");

		const setPlan = structuredClone(complete);
		const setIndex = setPlan.products.findIndex(
			({ draft }) => draft.productKind === "print_set",
		);
		const setProduct = setPlan.products[setIndex];
		if (setProduct.draft.productKind !== "print_set") throw new Error("Set fixture missing");
		setProduct.draft.printSources[0].assetId = alternate.printSourceAssetId;
		setProduct.sourceRelations.printSources[0].sourceAssetRef = alternate.sourceAssetRef;
		await refreshChecksums(setPlan, setIndex);
		await expect(assertSanityCatalogV2GraphPlan(setPlan))
			.rejects.toThrow("set Web and private source provenance do not match");
	});

	test("rejects graph, mapping-link, and source-metadata tampering", async () => {
		const manifest = createSanityCatalogImportManifest(sourceFixture());
		const plan = await createSanityCatalogV2GraphPlan(manifest, targetsFor(manifest));
		const graph = structuredClone(plan);
		graph.products[0].draft.title = "Changed after review";
		await expect(assertSanityCatalogV2GraphPlan(graph))
			.rejects.toThrow("Catalog graph checksum mismatch");

		const relation = structuredClone(plan);
		relation.products[0].sourceRelations.webMedia[0].sourceAssetRef =
			"image-a-1200x800-jpg";
		await expect(assertSanityCatalogV2GraphPlan(relation))
			.rejects.toThrow("source relation does not match its target graph");

		for (const [field, value, error] of [
			["sourceId", "", "Catalog source ID"],
			["sourceRevision", " revision ", "Catalog source revision"],
			["sourceCreatedAt", "not-a-date", "creation timestamp"],
			["productKey", "bad product key", "Product key"],
		] as const) {
			const source = structuredClone(plan);
			Object.assign(source.products[0], { [field]: value });
			await expect(assertSanityCatalogV2GraphPlan(source)).rejects.toThrow(error);
		}
	});
});
