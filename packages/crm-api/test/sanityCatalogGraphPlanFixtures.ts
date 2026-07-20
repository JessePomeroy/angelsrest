import type { Id } from "../convex/_generated/dataModel";
import { checksumCatalogProductGraphV2Draft } from "../convex/helpers/catalogProductGraphChecksum";
import type {
	SanityCatalogImportManifest,
	SanityCatalogImportSource,
} from "../convex/helpers/sanityCatalogImport";
import {
	checksumSanityCatalogV2GraphPlan,
	type SanityCatalogV2GraphPlan,
	type SanityCatalogV2TargetIdMaps,
} from "../convex/helpers/sanityCatalogGraphPlan";

export const CREATED_AT = "2026-01-01T00:00:00.000Z";
export const UPDATED_AT = "2026-07-19T12:00:00.000Z";

function metadata(id: string, type: string) {
	return {
		_id: id,
		_type: type,
		_rev: `revision-${id}`,
		_createdAt: CREATED_AT,
		_updatedAt: UPDATED_AT,
	};
}

export function image(key: string, ref: string) {
	return { _key: key, assetRef: ref, alt: `Description for ${key}.` };
}

export function sourceFixture(): SanityCatalogImportSource {
	return {
		prints: [{
			...metadata("print-b", "lumaProductV2"),
			title: "One Print",
			slug: "one-print",
			description: "A print description.",
			image: { assetRef: "image-a-1200x800-jpg", alt: "A quiet landscape." },
			variants: [{
				_key: "print-variant",
				paper: "archival-matte",
				size: "4x6",
				retailPrice: 15,
				enabled: true,
			}],
			bordersEnabled: true,
			framedEnabled: false,
			frameMarkupMultiplier: 2,
			inStock: true,
			featured: false,
		}],
		sets: [{
			...metadata("set-a", "lumaPrintSetV2"),
			title: "Two Print Set",
			slug: "two-print-set",
			previewImage: {
				assetRef: "image-b-1200x800-jpg",
				alt: "The set cover.",
			},
			images: [
				image("member-one", "image-a-1200x800-jpg"),
				image("member-two", "image-c-1200x800-jpg"),
			],
			variants: [{
				_key: "set-variant",
				paper: "glossy",
				size: "4x6",
				retailPrice: 33,
				enabled: true,
			}],
			bordersEnabled: true,
			framedEnabled: false,
			frameMarkupMultiplier: 2,
			inStock: true,
			featured: false,
		}],
		general: [
			{
				...metadata("tapestry-z", "product"),
				title: "Woven Piece",
				slug: "woven-piece",
				description: "A woven wall piece.",
				images: [image("tapestry-image", "image-d-1200x800-jpg")],
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
				images: [image("digital-image", "image-e-1200x800-png")],
				price: 15,
				category: "digital",
				digitalFileRef: "file-a-zip",
				digitalFileAsset: {
					_id: "file-a-zip",
					originalFilename: "theme-kit.zip",
					mimeType: "application/zip",
					size: 15_064,
				},
				digitalFileVersion: "1.0.0",
				inStock: true,
				featured: true,
			},
			{
				...metadata("postcard-a", "product"),
				title: "Postcard",
				slug: "postcard",
				images: [image("postcard-image", "image-f-1200x800-jpg")],
				price: 5,
				category: "postcards",
				inStock: true,
				featured: false,
			},
			{
				...metadata("merchandise-a", "product"),
				title: "Merchandise",
				slug: "merchandise",
				images: [image("merchandise-image", "image-g-1200x800-jpg")],
				price: 25,
				category: "merchandise",
				inStock: true,
				featured: false,
			},
		],
		collections: [],
		coupons: [],
	};
}

export function targetsFor(
	manifest: SanityCatalogImportManifest,
): SanityCatalogV2TargetIdMaps {
	const webRefs = new Set<string>();
	const printRefs = new Set<string>();
	const paidRefs = new Set<string>();
	for (const product of manifest.products) {
		for (const placement of product.media) {
			webRefs.add(placement.sourceAssetRef);
			if (placement.printSource) printRefs.add(placement.sourceAssetRef);
		}
		if (product.digitalFile) paidRefs.add(product.digitalFile.sourceFileRef);
	}
	return {
		webMedia: [...webRefs].sort().map((sourceAssetRef, index) => ({
			sourceAssetRef,
			mediaAssetId: `web.asset.${index + 1}` as Id<"mediaAssets">,
		})),
		printSources: [...printRefs].sort().map((sourceAssetRef, index) => ({
			sourceAssetRef,
			printSourceAssetId: `print.asset.${index + 1}` as Id<"catalogPrintSourceAssets">,
		})),
		paidFiles: [...paidRefs].sort().map((sourceFileRef, index) => ({
			sourceFileRef,
			digitalFileAssetId: `paid.asset.${index + 1}` as Id<"catalogDigitalFileAssets">,
		})),
	};
}

export function reversed<T>(values: ReadonlyArray<T>) {
	return [...values].reverse();
}

export async function refreshChecksums(
	plan: SanityCatalogV2GraphPlan,
	productIndex: number,
) {
	plan.products[productIndex].graphChecksum = await checksumCatalogProductGraphV2Draft(
		plan.products[productIndex].draft,
	);
	const { graphPlanChecksum: _previous, ...payload } = plan;
	plan.graphPlanChecksum = await checksumSanityCatalogV2GraphPlan(payload);
}
