import type {
	SanityCatalogImportDryRunReport,
	SanityCatalogImportIssue,
	SanityCatalogImportKind,
	SanityCatalogImportManifest,
	SanityCatalogImportReadiness,
	SanityCatalogImportSource,
} from "./sanityCatalogImportContract";
import {
	convertGeneral,
	convertPrint,
	convertPrintSet,
} from "./sanityCatalogImportProductAdapter";
import {
	compareOrdinal,
	issue,
	sortedIssues,
	stableSourceSort,
	text,
	validateTargetFields,
} from "./sanityCatalogImportSupport";

export type {
	SanityCatalogAssetSource,
	SanityCatalogCollectionSource,
	SanityCatalogCouponSource,
	SanityCatalogGeneralProductSource,
	SanityCatalogImageSource,
	SanityCatalogImportDryRunReport,
	SanityCatalogImportIssue,
	SanityCatalogImportKind,
	SanityCatalogImportManifest,
	SanityCatalogImportMediaPlacement,
	SanityCatalogImportProduct,
	SanityCatalogImportReadiness,
	SanityCatalogImportSource,
	SanityCatalogImportVariant,
	SanityCatalogPrintSetSource,
	SanityCatalogPrintSource,
	SanityCatalogVariantSource,
} from "./sanityCatalogImportContract";

function mediaSourcePath(
	product: SanityCatalogImportManifest["products"][number],
	placement: SanityCatalogImportManifest["products"][number]["media"][number],
) {
	if (placement.role === "primary") return `${product.sourcePath}.image.assetSource`;
	if (placement.role === "cover") return `${product.sourcePath}.previewImage.assetSource`;
	if (placement.role === "social_share") return `${product.sourcePath}.seo.ogImage.assetSource`;
	return `${product.sourcePath}.images[${placement.order}].assetSource`;
}

function validateRepeatedAssetProvenance(products: SanityCatalogImportManifest["products"]) {
	const seen = new Map<string, { sourceAssetId: string; sourceAssetRevision: string }>();
	for (const product of products) {
		const assets = [
			...product.media.map((placement) => ({
				path: mediaSourcePath(product, placement),
				sourceAssetRef: placement.sourceAssetRef,
				sourceAssetId: placement.sourceAssetId,
				sourceAssetRevision: placement.sourceAssetRevision,
			})),
			...(product.digitalFile
				? [{
						path: `${product.sourcePath}.digitalFileAsset`,
						sourceAssetRef: product.digitalFile.sourceFileRef,
						sourceAssetId: product.digitalFile.sourceAssetId,
						sourceAssetRevision: product.digitalFile.sourceAssetRevision,
					}]
				: []),
		];
		for (const asset of assets) {
			const previous = seen.get(asset.sourceAssetRef);
			if (
				previous
				&& (
					previous.sourceAssetId !== asset.sourceAssetId
					|| previous.sourceAssetRevision !== asset.sourceAssetRevision
				)
			) {
				product.issues.push(
					issue(
						"invalid-source-metadata",
						asset.path,
						"Repeated Sanity asset references must preserve one exact asset identity and revision",
					),
				);
				continue;
			}
			seen.set(asset.sourceAssetRef, {
				sourceAssetId: asset.sourceAssetId,
				sourceAssetRevision: asset.sourceAssetRevision,
			});
		}
	}
}

export function createSanityCatalogImportManifest(
	source: SanityCatalogImportSource,
): SanityCatalogImportManifest {
	const products = [
		...[...(source.prints ?? [])].sort(stableSourceSort).map(convertPrint),
		...[...(source.sets ?? [])].sort(stableSourceSort).map(convertPrintSet),
		...[...(source.general ?? [])].sort(stableSourceSort).map(convertGeneral),
	].sort((left, right) => compareOrdinal(left.productKey, right.productKey));
	const collections = [...(source.collections ?? [])].sort(stableSourceSort);
	const coupons = [...(source.coupons ?? [])].sort(stableSourceSort);

	const sourceIds = new Set<string>();
	const productKeys = new Set<string>();
	const slugs = new Set<string>();
	const collectionIds = new Set(
		collections.map((collection) => text(collection._id)).filter((id): id is string => Boolean(id)),
	);
	for (const product of products) {
		validateTargetFields(product);
		if (sourceIds.has(product.sourceId)) {
			product.issues.push(
				issue(
					"duplicate-source-id",
					`${product.sourcePath}._id`,
					"Catalog source IDs must be unique across product families",
				),
			);
		}
		sourceIds.add(product.sourceId);
		if (productKeys.has(product.productKey)) {
			product.issues.push(
				issue(
					"duplicate-product-key",
					`${product.sourcePath}._id`,
					"Normalized catalog product keys must be unique",
				),
			);
		}
		productKeys.add(product.productKey);
		if (product.slug) {
			if (slugs.has(product.slug)) {
				product.issues.push(
					issue(
						"duplicate-slug",
						`${product.sourcePath}.slug`,
						"Catalog slugs must be unique across product families",
					),
				);
			}
			slugs.add(product.slug);
		}
		if (product.sourceCollectionId && !collectionIds.has(product.sourceCollectionId)) {
			product.issues.push(
				issue(
					"missing-exported-reference",
					`${product.sourcePath}.sourceCollectionId`,
					"Product references a collection absent from the catalog source snapshot",
				),
			);
		}
	}
	validateRepeatedAssetProvenance(products);
	for (const product of products) product.issues = sortedIssues(product.issues);

	const manifestIssues = products.flatMap((product) => product.issues);
	if (collections.length > 0) {
		manifestIssues.push(
			issue(
				"unsupported-source-document",
				"$.collections",
				"Collection documents require the later collection migration contract",
			),
		);
	}
	if (coupons.length > 0) {
		manifestIssues.push(
			issue(
				"unsupported-source-document",
				"$.coupons",
				"Coupon documents require the later transactional coupon contract",
			),
		);
	}

	return {
		version: 1,
		products,
		sourceExtras: { collections: collections.length, coupons: coupons.length },
		issues: sortedIssues(manifestIssues),
	};
}

export function createSanityCatalogImportDryRunReport(
	manifest: SanityCatalogImportManifest,
): SanityCatalogImportDryRunReport {
	const imageRefs = new Set<string>();
	const printSourceRefs = new Set<string>();
	const fileRefs = new Set<string>();
	const productsByKind: Record<SanityCatalogImportKind, number> = {
		print: 0,
		print_set: 0,
		postcard: 0,
		tapestry: 0,
		digital_download: 0,
		merchandise: 0,
		unsupported: 0,
	};
	let sourceExplicitVariants = 0;
	let normalizedVariants = 0;
	let mediaPlacements = 0;
	let printSourcePlacements = 0;
	let printSetMembers = 0;
	let digitalFiles = 0;
	let compatibilityDefaultsApplied = 0;
	for (const product of manifest.products) {
		productsByKind[product.kind] += 1;
		sourceExplicitVariants += product.variants.filter(
			(variant) => variant.origin === "source_variant",
		).length;
		normalizedVariants += product.variants.length;
		mediaPlacements += product.media.length;
		printSetMembers += product.printSetMembers?.length ?? 0;
		compatibilityDefaultsApplied += product.normalizations.length;
		for (const placement of product.media) {
			imageRefs.add(placement.sourceAssetRef);
			if (placement.printSource) {
				printSourcePlacements += 1;
				printSourceRefs.add(placement.sourceAssetRef);
			}
		}
		if (product.digitalFile) {
			digitalFiles += 1;
			fileRefs.add(product.digitalFile.sourceFileRef);
		}
	}
	const readiness = (issues: SanityCatalogImportIssue[]): SanityCatalogImportReadiness => {
		const blockingIssues = issues.filter((item) => item.severity === "error");
		const warningIssues = issues.filter((item) => item.severity === "warning");
		return {
			status: blockingIssues.length > 0
				? "blocked"
				: warningIssues.length > 0
					? "ready-with-warnings"
					: "ready",
			counts: { errors: blockingIssues.length, warnings: warningIssues.length },
			blockingIssues,
			warningIssues,
			issues,
		};
	};
	const draftImport = readiness(manifest.issues);
	// Existing Shop alt gaps are legacy remediation debt. They remain visible here without
	// blocking an unpublished import or silently inventing replacement descriptions.
	const publicationRemediation = readiness(manifest.issues);
	return {
		version: 1,
		counts: {
			products: manifest.products.length,
			productsByKind,
			sourceExplicitVariants,
			normalizedVariants,
			mediaPlacements,
			uniqueSourceImages: imageRefs.size,
			printSourcePlacements,
			uniquePrintSourceImages: printSourceRefs.size,
			printSetMembers,
			digitalFiles,
			compatibilityDefaultsApplied,
			collections: manifest.sourceExtras.collections,
			coupons: manifest.sourceExtras.coupons,
		},
		requiredSourceImageRefs: [...imageRefs].sort(compareOrdinal),
		requiredPrintSourceImageRefs: [...printSourceRefs].sort(compareOrdinal),
		requiredSourceFileRefs: [...fileRefs].sort(compareOrdinal),
		draftImport,
		publicationRemediation,
	};
}
