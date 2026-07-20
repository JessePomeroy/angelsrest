import { describe, expect, test } from "vitest";
import {
	createSanityCatalogImportDryRunReport,
	createSanityCatalogImportManifest,
	type SanityCatalogImportSource,
} from "./helpers/sanityCatalogImport";

const CREATED_AT = "2026-01-01T00:00:00.000Z";
const UPDATED_AT = "2026-07-19T12:00:00.000Z";
const PRINT_IMAGE = "image-a-1200x800-jpg";
const SET_COVER = "image-b-1200x800-jpg";
const SET_SECOND_IMAGE = "image-c-1200x800-jpg";
const TAPESTRY_IMAGE = "image-d-1200x800-jpg";
const DIGITAL_IMAGE = "image-e-1200x800-png";

function assetSource(id: string) {
	return { _id: id, _rev: `asset-revision-${id}` };
}

function metadata(id: string, type: string) {
	return {
		_id: id,
		_type: type,
		_rev: `revision-${id}`,
		_createdAt: CREATED_AT,
		_updatedAt: UPDATED_AT,
	};
}

function sourceFixture(): SanityCatalogImportSource {
	return {
		prints: [
			{
				...metadata("print-b", "lumaProductV2"),
				title: "One Print",
				slug: "one-print",
				description: "A print description.",
				image: {
					assetRef: PRINT_IMAGE,
					assetSource: assetSource(PRINT_IMAGE),
					alt: "A quiet landscape.",
				},
				variants: [
					{
						_key: "print-variant",
						paper: "archival-matte",
						size: "4x6",
						retailPrice: 15,
						enabled: true,
					},
				],
				bordersEnabled: true,
				framedEnabled: false,
				frameMarkupMultiplier: 2,
				inStock: true,
				featured: false,
			},
		],
		sets: [
			{
				...metadata("set-a", "lumaPrintSetV2"),
				title: "Two Print Set",
				slug: "two-print-set",
				previewImage: {
					assetRef: SET_COVER,
					assetSource: assetSource(SET_COVER),
					alt: "The two-print set cover.",
				},
				images: [
					{
						_key: "member-one",
						assetRef: PRINT_IMAGE,
						assetSource: assetSource(PRINT_IMAGE),
						alt: "The first print.",
					},
					{
						_key: "member-two",
						assetRef: SET_SECOND_IMAGE,
						assetSource: assetSource(SET_SECOND_IMAGE),
						alt: "The second print.",
					},
				],
				variants: [
					{
						_key: "set-variant",
						paper: "glossy",
						size: "4x6",
						retailPrice: 33,
						enabled: true,
					},
				],
				bordersEnabled: true,
				framedEnabled: false,
				frameMarkupMultiplier: 2,
				inStock: true,
				featured: false,
			},
		],
		general: [
			{
				...metadata("tapestry-z", "product"),
				title: "Woven Piece",
				slug: "woven-piece",
				description: "A woven wall piece.",
				images: [
					{
						_key: "tapestry-image",
						assetRef: TAPESTRY_IMAGE,
						assetSource: assetSource(TAPESTRY_IMAGE),
						alt: "A woven wall piece.",
					},
				],
				price: 189,
				category: "tapestries",
				orderRank: "0|100000:",
				inStock: true,
				featured: false,
			},
			{
				...metadata("digital-a", "product"),
				title: "Theme Kit",
				slug: "theme-kit",
				description: "A downloadable theme kit.",
				images: [
					{
						_key: "digital-image",
						assetRef: DIGITAL_IMAGE,
						assetSource: assetSource(DIGITAL_IMAGE),
						alt: "Theme kit preview.",
					},
				],
				price: 15,
				category: "digital",
				digitalFileRef: "file-a-zip",
				digitalFileAsset: {
					_id: "file-a-zip",
					_rev: "asset-revision-file-a-zip",
					originalFilename: "theme-kit.zip",
					mimeType: "application/zip",
					size: 15_064,
				},
				digitalFileVersion: "1.0.0",
				inStock: true,
				featured: true,
			},
		],
		collections: [],
		coupons: [],
	};
}

describe("Sanity catalog import adapter", () => {
	test("normalizes every active catalog family without losing order, prices, or source identity", () => {
		const manifest = createSanityCatalogImportManifest(sourceFixture());
		const report = createSanityCatalogImportDryRunReport(manifest);

		expect(manifest.version).toBe(1);
		expect(manifest.products.map((product) => product.productKey)).toEqual([
			"sanity.catalog.digital-a",
			"sanity.catalog.print-b",
			"sanity.catalog.set-a",
			"sanity.catalog.tapestry-z",
		]);
		const print = manifest.products.find((product) => product.sourceId === "print-b");
		expect(print).toMatchObject({
			sourceType: "lumaProductV2",
			sourceRevision: "revision-print-b",
			kind: "print",
			fulfillmentMode: "production_partner",
			saleAvailability: "available",
			printOptions: {
				borderOptionsEnabled: true,
				frameOptionsEnabled: false,
				framePriceMultiplierBasisPoints: 20_000,
			},
			variants: [
				{
					key: "print-variant",
					origin: "source_variant",
					materialOptionKey: "archival-matte",
					sizeOptionKey: "4x6",
					retailPriceCents: 1_500,
					status: "enabled",
				},
			],
			media: [
				{
					key: "primary",
					role: "primary",
					order: 0,
					sourceAssetRef: PRINT_IMAGE,
					sourceAssetId: PRINT_IMAGE,
					sourceAssetRevision: `asset-revision-${PRINT_IMAGE}`,
					printSource: true,
				},
			],
		});
		expect(print?.sourceRevision).not.toBe(print?.media[0]?.sourceAssetRevision);

		const set = manifest.products.find((product) => product.kind === "print_set");
		expect(set?.media.map(({ key, role, order, printSource }) => ({
			key,
			role,
			order,
			printSource,
		}))).toEqual([
			{ key: "cover", role: "cover", order: 0, printSource: false },
			{ key: "member-one", role: "set_member", order: 0, printSource: true },
			{ key: "member-two", role: "set_member", order: 1, printSource: true },
		]);
		expect(set?.printSetMembers).toEqual([
			{
				key: "member-one",
				order: 0,
				mediaPlacementKey: "member-one",
				sourceAssetRef: PRINT_IMAGE,
			},
			{
				key: "member-two",
				order: 1,
				mediaPlacementKey: "member-two",
				sourceAssetRef: SET_SECOND_IMAGE,
			},
		]);

		const tapestry = manifest.products.find((product) => product.kind === "tapestry");
		expect(tapestry).toMatchObject({
			fulfillmentMode: "merchant_fulfilled",
			shopPlacement: { featured: false, orderRank: "0|100000:" },
			variants: [
				{
					key: "default",
					origin: "fixed_price",
					retailPriceCents: 18_900,
					status: "enabled",
				},
			],
		});
		const digital = manifest.products.find((product) => product.kind === "digital_download");
		expect(digital).toMatchObject({
			fulfillmentMode: "digital_delivery",
			shopPlacement: { featured: true },
			digitalFile: {
				sourceFileRef: "file-a-zip",
				sourceAssetId: "file-a-zip",
				sourceAssetRevision: "asset-revision-file-a-zip",
				originalFilename: "theme-kit.zip",
				mimeType: "application/zip",
				sizeBytes: 15_064,
				version: "1.0.0",
			},
		});

		expect(report).toMatchObject({
			counts: {
				products: 4,
				productsByKind: {
					print: 1,
					print_set: 1,
					postcard: 0,
					tapestry: 1,
					digital_download: 1,
					merchandise: 0,
					unsupported: 0,
				},
				sourceExplicitVariants: 2,
				normalizedVariants: 4,
				mediaPlacements: 6,
				uniqueSourceImages: 5,
				printSourcePlacements: 3,
				uniquePrintSourceImages: 2,
				printSetMembers: 2,
				digitalFiles: 1,
				compatibilityDefaultsApplied: 0,
			},
			draftImport: { status: "ready", counts: { errors: 0, warnings: 0 } },
			publicationRemediation: { status: "ready", counts: { errors: 0, warnings: 0 } },
			requiredSourceFileRefs: ["file-a-zip"],
		});
	});

	test.each([
		[
			"a whitespace-padded asset reference",
			(source: SanityCatalogImportSource) => {
				if (source.prints[0].image) source.prints[0].image.assetRef = ` ${PRINT_IMAGE} `;
			},
			"invalid-image-reference",
			"$.prints[0].image.assetRef",
		],
		[
			"a mismatched dereferenced ID",
			(source: SanityCatalogImportSource) => {
				if (source.prints[0].image?.assetSource) {
					source.prints[0].image.assetSource._id = "image-other-1200x800-jpg";
				}
			},
			"invalid-image-reference",
			"$.prints[0].image.assetSource._id",
		],
		[
			"a null dereference",
			(source: SanityCatalogImportSource) => {
				if (source.prints[0].image) source.prints[0].image.assetSource = null;
			},
			"invalid-image-reference",
			"$.prints[0].image.assetSource._id",
		],
		[
			"a missing asset revision",
			(source: SanityCatalogImportSource) => {
				if (source.prints[0].image?.assetSource) {
					delete source.prints[0].image.assetSource._rev;
				}
			},
			"invalid-source-metadata",
			"$.prints[0].image.assetSource._rev",
		],
		[
			"a blank asset revision",
			(source: SanityCatalogImportSource) => {
				if (source.prints[0].image?.assetSource) source.prints[0].image.assetSource._rev = "";
			},
			"invalid-source-metadata",
			"$.prints[0].image.assetSource._rev",
		],
		[
			"a whitespace-padded asset revision",
			(source: SanityCatalogImportSource) => {
				if (source.prints[0].image?.assetSource) {
					source.prints[0].image.assetSource._rev = " asset-revision ";
				}
			},
			"invalid-source-metadata",
			"$.prints[0].image.assetSource._rev",
		],
		[
			"an overlong asset revision",
			(source: SanityCatalogImportSource) => {
				if (source.prints[0].image?.assetSource) {
					source.prints[0].image.assetSource._rev = "r".repeat(257);
				}
			},
			"invalid-source-metadata",
			"$.prints[0].image.assetSource._rev",
		],
		[
			"an asset revision containing a control character",
			(source: SanityCatalogImportSource) => {
				if (source.prints[0].image?.assetSource) {
					source.prints[0].image.assetSource._rev = "asset\u0000revision";
				}
			},
			"invalid-source-metadata",
			"$.prints[0].image.assetSource._rev",
		],
		[
			"a paid-file ID mismatch",
			(source: SanityCatalogImportSource) => {
				if (source.general[1].digitalFileAsset) {
					source.general[1].digitalFileAsset._id = "file-other-zip";
				}
			},
			"invalid-file-reference",
			"$.general[0].digitalFileAsset._id",
		],
		[
			"a missing paid-file asset revision",
			(source: SanityCatalogImportSource) => {
				if (source.general[1].digitalFileAsset) {
					delete source.general[1].digitalFileAsset._rev;
				}
			},
			"invalid-source-metadata",
			"$.general[0].digitalFileAsset._rev",
		],
	] as const)("blocks %s instead of inferring provenance from the product", (_label, mutate, code, path) => {
		const source = sourceFixture();
		mutate(source);

		const report = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest(source),
		);

		expect(report.draftImport.status).toBe("blocked");
		expect(report.draftImport.blockingIssues).toContainEqual(
			expect.objectContaining({ code, path }),
		);
	});

	test("accepts identical shared-asset provenance and blocks conflicting repeated revisions", () => {
		const valid = createSanityCatalogImportManifest(sourceFixture());
		const shared = valid.products.flatMap((product) => product.media)
			.filter((placement) => placement.sourceAssetRef === PRINT_IMAGE);
		expect(shared).toHaveLength(2);
		expect(new Set(shared.map((placement) => placement.sourceAssetRevision))).toEqual(
			new Set([`asset-revision-${PRINT_IMAGE}`]),
		);

		const conflicting = sourceFixture();
		const repeated = conflicting.sets[0].images?.[0]?.assetSource;
		if (repeated) repeated._rev = "conflicting-asset-revision";
		const report = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest(conflicting),
		);

		expect(report.draftImport.status).toBe("blocked");
		expect(report.draftImport.blockingIssues).toContainEqual(
			expect.objectContaining({
				code: "invalid-source-metadata",
				path: "$.sets[0].images[0].assetSource",
			}),
		);
	});

	test("preserves singleton and SEO asset provenance without requiring placement keys", () => {
		const source = sourceFixture();
		source.general[0].seo = {
			ogImage: {
				assetRef: SET_COVER,
				assetSource: assetSource(SET_COVER),
			},
		};

		const manifest = createSanityCatalogImportManifest(source);
		const print = manifest.products.find((product) => product.kind === "print");
		const social = manifest.products.find((product) => product.kind === "tapestry")?.media
			.find((placement) => placement.role === "social_share");

		expect(print?.media[0]).toMatchObject({
			key: "primary",
			sourceAssetId: PRINT_IMAGE,
			sourceAssetRevision: `asset-revision-${PRINT_IMAGE}`,
		});
		expect(social).toMatchObject({
			key: "social-share",
			sourceAssetId: SET_COVER,
			sourceAssetRevision: `asset-revision-${SET_COVER}`,
		});
	});

	test("keeps the paid-file asset revision separate from its product-authored version", () => {
		const manifest = createSanityCatalogImportManifest(sourceFixture());
		const digital = manifest.products.find((product) => product.kind === "digital_download");

		expect(digital?.digitalFile).toMatchObject({
			sourceFileRef: "file-a-zip",
			sourceAssetId: "file-a-zip",
			sourceAssetRevision: "asset-revision-file-a-zip",
			version: "1.0.0",
		});
		expect(digital?.digitalFile?.sourceAssetRevision).not.toBe(
			digital?.digitalFile?.version,
		);
	});

	test("blocks conflicting provenance when multiple products reference the same paid file", () => {
		const source = sourceFixture();
		const original = source.general[1];
		if (!original.digitalFileAsset) throw new Error("Digital fixture is missing its file asset");
		source.general.push({
			...structuredClone(original),
			...metadata("digital-b", "product"),
			title: "Second Theme Kit",
			slug: "second-theme-kit",
			digitalFileAsset: {
				...original.digitalFileAsset,
				_rev: "conflicting-paid-file-revision",
			},
		});

		const report = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest(source),
		);

		expect(report.draftImport.status).toBe("blocked");
		expect(report.draftImport.blockingIssues).toContainEqual(
			expect.objectContaining({
				code: "invalid-source-metadata",
				path: "$.general[1].digitalFileAsset",
			}),
		);
	});

	test("still blocks a non-digital product carrying a padded paid-file reference", () => {
		const source = sourceFixture();
		source.general[0].digitalFileRef = " file-unexpected-zip ";
		const report = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest(source),
		);

		expect(report.draftImport.status).toBe("blocked");
		expect(report.draftImport.blockingIssues).toContainEqual(
			expect.objectContaining({
				code: "invalid-file-reference",
				path: "$.general[1].digitalFileRef",
			}),
		);
	});

	test("records storefront-compatible defaults and keeps missing alt text as a draft warning", () => {
		const source = sourceFixture();
		delete source.prints[0].bordersEnabled;
		delete source.prints[0].framedEnabled;
		delete source.prints[0].frameMarkupMultiplier;
		delete source.prints[0].inStock;
		delete source.prints[0].featured;
		delete source.prints[0].image?.alt;

		const manifest = createSanityCatalogImportManifest(source);
		const print = manifest.products.find((product) => product.kind === "print");
		const report = createSanityCatalogImportDryRunReport(manifest);

		expect(print?.normalizations).toEqual([
			"inStock=true",
			"featured=false",
			"bordersEnabled=true",
			"framedEnabled=false",
			"frameMarkupMultiplier=2",
		]);
		expect(report.draftImport.status).toBe("ready-with-warnings");
		expect(report.publicationRemediation.status).toBe("ready-with-warnings");
		expect(report.counts.compatibilityDefaultsApplied).toBe(5);
		expect(report.draftImport.warningIssues).toEqual([
			expect.objectContaining({
				code: "missing-image-alt",
				path: "$.prints[0].image.alt",
			}),
		]);
	});

	test("blocks corrupt compatibility values instead of silently changing pricing or sellability", () => {
		const source = sourceFixture();
		source.prints[0].inStock = "true";
		source.prints[0].featured = {};
		source.prints[0].bordersEnabled = "yes";
		source.prints[0].framedEnabled = 0;
		source.prints[0].frameMarkupMultiplier = "2";
		if (source.prints[0].variants?.[0]) {
			source.prints[0].variants[0].enabled = "true";
		}

		const report = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest(source),
		);
		const corruptPaths = report.draftImport.blockingIssues
			.filter((item) => item.code === "invalid-source-metadata")
			.map((item) => item.path);

		expect(report.draftImport.status).toBe("blocked");
		expect(corruptPaths).toEqual(
			expect.arrayContaining([
				"$.prints[0].inStock",
				"$.prints[0].featured",
				"$.prints[0].bordersEnabled",
				"$.prints[0].framedEnabled",
				"$.prints[0].frameMarkupMultiplier",
				"$.prints[0].variants[0].enabled",
			]),
		);
	});

	test("blocks invalid prices, unstable ordered children, and duplicate catalog identities", () => {
		const source = sourceFixture();
		source.prints[0].variants = [
			{
				_key: "duplicate",
				paper: "glossy",
				size: "4x6",
				retailPrice: 10.001,
			},
			{
				_key: "duplicate",
				paper: "glossy",
				size: "4x6",
				retailPrice: 10,
			},
		];
		delete source.sets[0].images?.[0]._key;
		source.general[0].slug = "theme-kit";

		const report = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest(source),
		);
		const codes = report.draftImport.blockingIssues.map((item) => item.code);

		expect(report.draftImport.status).toBe("blocked");
		expect(codes).toEqual(
			expect.arrayContaining([
				"invalid-price",
				"duplicate-variant-key",
				"duplicate-variant-options",
				"missing-required-field",
				"duplicate-slug",
			]),
		);
	});

	test("fails closed when unmapped source families, collections, coupons, or digital files appear", () => {
		const source = sourceFixture();
		source.general[0].category = "something-new";
		delete source.general[1].digitalFileRef;
		source.collections.push({
			...metadata("collection-a", "printCollection"),
			title: "Collection",
			slug: "collection",
		});
		source.coupons.push({ ...metadata("coupon-a", "coupon"), code: "SAVE" });

		const report = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest(source),
		);

		expect(report.draftImport.status).toBe("blocked");
		expect(report.counts.collections).toBe(1);
		expect(report.counts.coupons).toBe(1);
		expect(report.draftImport.blockingIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "unsupported-category" }),
				expect.objectContaining({ code: "invalid-file-reference" }),
				expect.objectContaining({
					code: "unsupported-source-document",
					path: "$.collections",
				}),
				expect.objectContaining({
					code: "unsupported-source-document",
					path: "$.coupons",
				}),
			]),
		);
	});

	test("fails closed when an unmapped available-papers field carries source data", () => {
		const source = sourceFixture();
		source.general[0].availablePapers = ["archival-matte"];

		const report = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest(source),
		);

		expect(report.draftImport.status).toBe("blocked");
		expect(report.draftImport.blockingIssues).toContainEqual(
			expect.objectContaining({
				code: "unsupported-source-field",
				path: "$.general[1].availablePapers",
			}),
		);

		const emptyFieldSource = sourceFixture();
		emptyFieldSource.general[0].availablePapers = [];
		const emptyFieldReport = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest(emptyFieldSource),
		);
		expect(emptyFieldReport.draftImport.blockingIssues).not.toEqual(
			expect.arrayContaining([
				expect.objectContaining({ code: "unsupported-source-field" }),
			]),
		);
	});

	test("uses ordinal source ordering and preserves missing enabled as disabled", () => {
		const source = sourceFixture();
		delete source.prints[0].variants?.[0].enabled;
		const reordered = structuredClone(source);
		reordered.general.reverse();
		reordered.prints.reverse();
		reordered.sets.reverse();

		const original = createSanityCatalogImportManifest(source);
		const repeated = createSanityCatalogImportManifest(reordered);
		const print = original.products.find((product) => product.kind === "print");

		expect(repeated).toEqual(original);
		expect(print?.variants[0].status).toBe("disabled");
		expect(print?.normalizations).toContain("variant:print-variant.enabled=false");
	});

	test("maps postcard and merchandise capabilities without inventing print fulfillment", () => {
		const source = sourceFixture();
		source.general.push(
			{
				...metadata("postcard-a", "product"),
				title: "Postcard",
				slug: "postcard",
				images: [
					{
						_key: "postcard-image",
						assetRef: "image-f-1200x800-jpg",
						assetSource: assetSource("image-f-1200x800-jpg"),
						alt: "A postcard.",
					},
				],
				price: 5,
				category: "postcards",
				inStock: true,
				featured: false,
			},
			{
				...metadata("merchandise-a", "product"),
				title: "Merchandise",
				slug: "merchandise",
				images: [
					{
						_key: "merchandise-image",
						assetRef: "image-g-1200x800-jpg",
						assetSource: assetSource("image-g-1200x800-jpg"),
						alt: "A merchandise item.",
					},
				],
				price: 25,
				category: "merchandise",
				inStock: true,
				featured: false,
			},
		);

		const manifest = createSanityCatalogImportManifest(source);
		const postcard = manifest.products.find((product) => product.kind === "postcard");
		const merchandise = manifest.products.find((product) => product.kind === "merchandise");

		expect(postcard).toMatchObject({
			fulfillmentMode: "merchant_fulfilled",
			variants: [{ key: "default", retailPriceCents: 500 }],
		});
		expect(merchandise).toMatchObject({
			fulfillmentMode: "merchant_fulfilled",
			variants: [{ key: "default", retailPriceCents: 2_500 }],
		});
	});

	test("blocks malformed provenance and values outside the target catalog contract", () => {
		const source = sourceFixture();
		delete source.prints[0]._rev;
		source.prints[0]._createdAt = "2027-01-01T00:00:00.000Z";
		source.prints[0].title = "x".repeat(161);
		source.prints[0].slug = "Invalid-Slug";
		if (source.prints[0].variants?.[0]) {
			source.prints[0].variants[0].paper = "Archival Matte";
		}
		source.sets[0].frameMarkupMultiplier = 101;
		source.sets[0].variants = Array.from({ length: 101 }, (_, index) => ({
			_key: `variant-${index}`,
			paper: "glossy",
			size: `size-${index}`,
			retailPrice: 10,
			enabled: true,
		}));
		source.sets[0]._id = source.prints[0]._id;

		const report = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest(source),
		);
		const codes = report.draftImport.blockingIssues.map((item) => item.code);

		expect(report.draftImport.status).toBe("blocked");
		expect(codes).toEqual(
			expect.arrayContaining([
				"invalid-source-metadata",
				"invalid-target-field",
				"duplicate-source-id",
				"duplicate-product-key",
			]),
		);
		expect(report.draftImport.blockingIssues).toEqual(
			expect.arrayContaining([
				expect.objectContaining({
					code: "invalid-target-field",
					path: "$.sets[0].variants",
				}),
				expect.objectContaining({
					code: "invalid-target-field",
					path: "$.sets[0].frameMarkupMultiplier",
				}),
			]),
		);
	});

	test("does not silently reinterpret a legacy general-product print", () => {
		const source = sourceFixture();
		source.general[0].category = "prints";

		const manifest = createSanityCatalogImportManifest(source);
		const product = manifest.products.find((item) => item.sourceId === "tapestry-z");
		const report = createSanityCatalogImportDryRunReport(manifest);

		expect(product?.kind).toBe("print");
		expect(product?.issues).toContainEqual(
			expect.objectContaining({ code: "legacy-print-contract" }),
		);
		expect(report.draftImport.status).toBe("blocked");
	});
});
