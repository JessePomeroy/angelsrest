import type { CatalogFulfillmentMode } from "./catalogProductValidators";
import type {
	SanityCatalogGeneralProductSource,
	SanityCatalogImportIssue,
	SanityCatalogImportKind,
	SanityCatalogImportMediaPlacement,
	SanityCatalogImportProduct,
	SanityCatalogImportVariant,
	SanityCatalogPrintSetSource,
	SanityCatalogPrintSource,
	SanityCatalogProductBaseSource,
	SanityCatalogVariantSource,
} from "./sanityCatalogImportContract";
import {
	booleanDefault,
	cents,
	cleanSourceId,
	imagePlacement,
	isValidFileReference,
	issue,
	multiplierBasisPoints,
	requiredText,
	sourceMetadata,
	text,
	validatePlacementKeys,
} from "./sanityCatalogImportSupport";

function explicitVariants(
	value: SanityCatalogVariantSource[] | undefined,
	path: string,
	issues: SanityCatalogImportIssue[],
	normalizations: string[],
) {
	const variants = (Array.isArray(value) ? value : []).map((source, index) => {
		const variantPath = `${path}[${index}]`;
		const key = requiredText(source._key, `${variantPath}._key`, "Variant key", issues)
			?? `missing-variant-${index + 1}`;
		const materialOptionKey = requiredText(
			source.paper,
			`${variantPath}.paper`,
			"Variant paper",
			issues,
		);
		const sizeOptionKey = requiredText(
			source.size,
			`${variantPath}.size`,
			"Variant size",
			issues,
		);
		const retailPriceCents = cents(source.retailPrice, `${variantPath}.retailPrice`, issues);
		const enabled = source.enabled === true;
		if (source.enabled === undefined || source.enabled === null) {
			normalizations.push(`variant:${key}.enabled=false`);
		} else if (typeof source.enabled !== "boolean") {
			normalizations.push(`variant:${key}.enabled=false`);
			issues.push(
				issue(
					"invalid-source-metadata",
					`${variantPath}.enabled`,
					"Variant enabled must be a boolean when present",
				),
			);
		}
		return {
			key,
			origin: "source_variant" as const,
			...(materialOptionKey ? { materialOptionKey } : {}),
			...(sizeOptionKey ? { sizeOptionKey } : {}),
			...(retailPriceCents !== undefined ? { retailPriceCents } : {}),
			status: enabled ? ("enabled" as const) : ("disabled" as const),
		};
	});
	if (variants.length === 0) {
		issues.push(issue("missing-required-field", path, "Print product needs at least one variant"));
	}
	const keys = new Set<string>();
	const combinations = new Set<string>();
	for (const [index, variant] of variants.entries()) {
		if (keys.has(variant.key)) {
			issues.push(
				issue(
					"duplicate-variant-key",
					`${path}[${index}]._key`,
					"Variant keys must be unique per product",
				),
			);
		}
		keys.add(variant.key);
		if (variant.materialOptionKey && variant.sizeOptionKey) {
			const combination = `${variant.materialOptionKey}\u0000${variant.sizeOptionKey}`;
			if (combinations.has(combination)) {
				issues.push(
					issue(
						"duplicate-variant-options",
						`${path}[${index}]`,
						"Paper and size combination must be unique per product",
					),
				);
			}
			combinations.add(combination);
		}
	}
	return variants;
}

function commonProductFields(
	source: SanityCatalogProductBaseSource,
	path: string,
	issues: SanityCatalogImportIssue[],
	normalizations: string[],
) {
	const title = requiredText(source.title, `${path}.title`, "Product title", issues);
	const slug = requiredText(source.slug, `${path}.slug`, "Product slug", issues);
	const description = text(source.description);
	const available = booleanDefault(
		source.inStock,
		true,
		"inStock",
		normalizations,
		`${path}.inStock`,
		issues,
	);
	const featured = booleanDefault(
		source.featured,
		false,
		"featured",
		normalizations,
		`${path}.featured`,
		issues,
	);
	return {
		...(title ? { title } : {}),
		...(slug ? { slug } : {}),
		...(description ? { description } : {}),
		saleAvailability: available ? ("available" as const) : ("unavailable" as const),
		shopPlacement: { featured },
	};
}

function printOptions(
	source: {
		bordersEnabled?: unknown;
		framedEnabled?: unknown;
		frameMarkupMultiplier?: unknown;
	},
	path: string,
	issues: SanityCatalogImportIssue[],
	normalizations: string[],
) {
	return {
		borderOptionsEnabled: booleanDefault(
			source.bordersEnabled,
			true,
			"bordersEnabled",
			normalizations,
			`${path}.bordersEnabled`,
			issues,
		),
		frameOptionsEnabled: booleanDefault(
			source.framedEnabled,
			false,
			"framedEnabled",
			normalizations,
			`${path}.framedEnabled`,
			issues,
		),
		framePriceMultiplierBasisPoints: multiplierBasisPoints(
			source.frameMarkupMultiplier,
			normalizations,
			`${path}.frameMarkupMultiplier`,
			issues,
		),
	};
}

export function convertPrint(
	source: SanityCatalogPrintSource,
	index: number,
): SanityCatalogImportProduct {
	const sourcePath = `$.prints[${index}]`;
	const issues: SanityCatalogImportIssue[] = [];
	const normalizations: string[] = [];
	const metadata = sourceMetadata(source, "lumaProductV2", sourcePath, index, issues);
	const mediaPlacement = imagePlacement(
		source.image,
		{
			path: `${sourcePath}.image`,
			fallbackKey: "primary",
			requireSourceKey: false,
			role: "primary",
			order: 0,
			printSource: true,
			requireAlt: true,
		},
		issues,
	);
	if (!source.image) {
		issues.push(
			issue("missing-required-field", `${sourcePath}.image`, "Print source image is required"),
		);
	}
	const media = mediaPlacement ? [mediaPlacement] : [];
	return {
		sourcePath,
		...metadata,
		sourceType: "lumaProductV2" as const,
		kind: "print" as const,
		fulfillmentMode: "production_partner" as const,
		...commonProductFields(source, sourcePath, issues, normalizations),
		variants: explicitVariants(
			source.variants,
			`${sourcePath}.variants`,
			issues,
			normalizations,
		),
		media,
		printOptions: printOptions(source, sourcePath, issues, normalizations),
		normalizations,
		issues,
	} satisfies SanityCatalogImportProduct;
}

export function convertPrintSet(
	source: SanityCatalogPrintSetSource,
	index: number,
): SanityCatalogImportProduct {
	const sourcePath = `$.sets[${index}]`;
	const issues: SanityCatalogImportIssue[] = [];
	const normalizations: string[] = [];
	const metadata = sourceMetadata(source, "lumaPrintSetV2", sourcePath, index, issues);
	const media: SanityCatalogImportMediaPlacement[] = [];
	const cover = imagePlacement(
		source.previewImage,
		{
			path: `${sourcePath}.previewImage`,
			fallbackKey: "cover",
			requireSourceKey: false,
			role: "cover",
			order: 0,
			printSource: false,
			requireAlt: true,
		},
		issues,
	);
	if (cover) media.push(cover);
	for (const [imageIndex, image] of (Array.isArray(source.images) ? source.images : []).entries()) {
		const placement = imagePlacement(
			image,
			{
				path: `${sourcePath}.images[${imageIndex}]`,
				fallbackKey: `missing-set-member-${imageIndex + 1}`,
				requireSourceKey: true,
				role: "set_member",
				order: imageIndex,
				printSource: true,
				requireAlt: true,
			},
			issues,
		);
		if (placement) media.push(placement);
	}
	if (!Array.isArray(source.images) || source.images.length === 0) {
		issues.push(
			issue(
				"missing-required-field",
				`${sourcePath}.images`,
				"Print set needs at least one ordered print source image",
			),
		);
	}
	validatePlacementKeys(media, `${sourcePath}.media`, issues);
	const printSetMembers = media
		.filter((placement) => placement.role === "set_member")
		.map((placement) => ({
			key: placement.key,
			order: placement.order,
			mediaPlacementKey: placement.key,
			sourceAssetRef: placement.sourceAssetRef,
		}));
	const sourceCollectionId = text(source.parentRef);
	return {
		sourcePath,
		...metadata,
		sourceType: "lumaPrintSetV2" as const,
		kind: "print_set" as const,
		fulfillmentMode: "production_partner" as const,
		...commonProductFields(source, sourcePath, issues, normalizations),
		variants: explicitVariants(
			source.variants,
			`${sourcePath}.variants`,
			issues,
			normalizations,
		),
		media,
		printOptions: printOptions(source, sourcePath, issues, normalizations),
		printSetMembers,
		...(sourceCollectionId ? { sourceCollectionId: cleanSourceId(sourceCollectionId) } : {}),
		normalizations,
		issues,
	} satisfies SanityCatalogImportProduct;
}

function generalKind(category: string | undefined): SanityCatalogImportKind {
	if (category === "prints") return "print";
	if (category === "postcards") return "postcard";
	if (category === "tapestries") return "tapestry";
	if (category === "digital") return "digital_download";
	if (category === "merchandise") return "merchandise";
	return "unsupported";
}

function generalFulfillmentMode(kind: SanityCatalogImportKind): CatalogFulfillmentMode {
	if (kind === "digital_download") return "digital_delivery";
	return "merchant_fulfilled";
}

export function convertGeneral(
	source: SanityCatalogGeneralProductSource,
	index: number,
): SanityCatalogImportProduct {
	const sourcePath = `$.general[${index}]`;
	const issues: SanityCatalogImportIssue[] = [];
	const normalizations: string[] = [];
	const metadata = sourceMetadata(source, "product", sourcePath, index, issues);
	const category = text(source.category);
	const kind = generalKind(category);
	if (kind === "unsupported") {
		issues.push(
			issue(
				"unsupported-category",
				`${sourcePath}.category`,
				"General product category is not mapped to a local catalog kind",
			),
		);
	}
	if (category === "prints") {
		issues.push(
			issue(
				"legacy-print-contract",
				`${sourcePath}.category`,
				"Legacy general-product prints require an explicit source and fulfillment decision",
			),
		);
	}
	if (
		source.availablePapers !== undefined
		&& source.availablePapers !== null
		&& (!Array.isArray(source.availablePapers) || source.availablePapers.length > 0)
	) {
		issues.push(
			issue(
				"unsupported-source-field",
				`${sourcePath}.availablePapers`,
				"Available papers are not mapped to the local catalog and require an explicit migration decision",
			),
		);
	}
	const retailPriceCents = cents(source.price, `${sourcePath}.price`, issues);
	const variants: SanityCatalogImportVariant[] = [
		{
			key: "default",
			origin: "fixed_price",
			...(retailPriceCents !== undefined ? { retailPriceCents } : {}),
			status: "enabled",
		},
	];
	const media: SanityCatalogImportMediaPlacement[] = [];
	for (const [imageIndex, image] of (Array.isArray(source.images) ? source.images : []).entries()) {
		const placement = imagePlacement(
			image,
			{
				path: `${sourcePath}.images[${imageIndex}]`,
				fallbackKey: `missing-gallery-image-${imageIndex + 1}`,
				requireSourceKey: true,
				role: "gallery",
				order: imageIndex,
				printSource: false,
				requireAlt: true,
			},
			issues,
		);
		if (placement) media.push(placement);
	}
	if (!Array.isArray(source.images) || source.images.length === 0) {
		issues.push(
			issue(
				"missing-required-field",
				`${sourcePath}.images`,
				"General product needs at least one display image",
			),
		);
	}
	const socialShare = imagePlacement(
		source.seo?.ogImage,
		{
			path: `${sourcePath}.seo.ogImage`,
			fallbackKey: "social-share",
			requireSourceKey: false,
			role: "social_share",
			order: 0,
			printSource: false,
			requireAlt: false,
		},
		issues,
	);
	if (socialShare) media.push(socialShare);
	validatePlacementKeys(media, `${sourcePath}.media`, issues);
	const sourceCollectionId = text(source.collectionRef);
	const digitalFileRef = text(source.digitalFileRef);
	let digitalFile: SanityCatalogImportProduct["digitalFile"];
	if (kind === "digital_download") {
		if (!digitalFileRef || !isValidFileReference(digitalFileRef)) {
			issues.push(
				issue(
					"invalid-file-reference",
					`${sourcePath}.digitalFileRef`,
					"Digital download must reference one valid private Sanity file",
				),
			);
		} else {
			const sourceAssetId = text(source.digitalFileAsset?._id);
			const originalFilename = text(source.digitalFileAsset?.originalFilename);
			const mimeType = text(source.digitalFileAsset?.mimeType);
			const sizeBytes = source.digitalFileAsset?.size;
			if (sourceAssetId !== digitalFileRef) {
				issues.push(
					issue(
						"invalid-file-reference",
						`${sourcePath}.digitalFileAsset._id`,
						"Digital file metadata must resolve the exact referenced Sanity asset",
					),
				);
			}
			if (!originalFilename) {
				issues.push(
					issue(
						"missing-required-field",
						`${sourcePath}.digitalFileAsset.originalFilename`,
						"Digital file original filename is required",
					),
				);
			}
			if (!mimeType) {
				issues.push(
					issue(
						"missing-required-field",
						`${sourcePath}.digitalFileAsset.mimeType`,
						"Digital file media type is required",
					),
				);
			}
			if (!Number.isSafeInteger(sizeBytes) || (sizeBytes as number) <= 0) {
				issues.push(
					issue(
						"invalid-source-metadata",
						`${sourcePath}.digitalFileAsset.size`,
						"Digital file size must be a positive safe integer",
					),
				);
			}
			if (
				sourceAssetId === digitalFileRef
				&& originalFilename
				&& mimeType
				&& Number.isSafeInteger(sizeBytes)
				&& (sizeBytes as number) > 0
			) {
				digitalFile = {
					sourceFileRef: digitalFileRef,
					sourceAssetId,
					originalFilename,
					mimeType,
					sizeBytes: sizeBytes as number,
					...(text(source.digitalFileVersion)
						? { version: text(source.digitalFileVersion) }
						: {}),
				};
			}
		}
	} else if (digitalFileRef) {
		issues.push(
			issue(
				"invalid-file-reference",
				`${sourcePath}.digitalFileRef`,
				"Only digital-download products may reference a paid file",
			),
		);
	}
	const orderRank = text(source.orderRank);
	const common = commonProductFields(source, sourcePath, issues, normalizations);
	return {
		sourcePath,
		...metadata,
		sourceType: "product" as const,
		kind,
		fulfillmentMode: generalFulfillmentMode(kind),
		...common,
		shopPlacement: {
			...common.shopPlacement,
			...(orderRank ? { orderRank } : {}),
		},
		variants,
		media,
		...(sourceCollectionId ? { sourceCollectionId: cleanSourceId(sourceCollectionId) } : {}),
		...(digitalFile ? { digitalFile } : {}),
		...(text(source.seo?.description)
			? { seoDescription: text(source.seo?.description) }
			: {}),
		normalizations,
		issues,
	} satisfies SanityCatalogImportProduct;
}
