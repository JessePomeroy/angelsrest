import { CATALOG_PRODUCT_LIMITS } from "./catalogProductValidators";
import type {
	SanityCatalogDocumentSource,
	SanityCatalogImageSource,
	SanityCatalogImportIssue,
	SanityCatalogImportMediaPlacement,
	SanityCatalogImportProduct,
} from "./sanityCatalogImportContract";

const IMAGE_REF_PATTERN = /^image-[A-Za-z0-9]+-\d+x\d+-[A-Za-z0-9]+$/;
const FILE_REF_PATTERN = /^file-[A-Za-z0-9]+-[A-Za-z0-9.]+$/;
const PRODUCT_KEY_PATTERN = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
const OPTION_KEY_PATTERN = /^[a-z0-9]+(?:[._:-][a-z0-9]+)*$/;
const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_PRICE_CENTS = 100_000_000;

export function compareOrdinal(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

export function issue(
	code: SanityCatalogImportIssue["code"],
	path: string,
	message: string,
	severity: SanityCatalogImportIssue["severity"] = "error",
): SanityCatalogImportIssue {
	return { code, path, message, severity };
}

export function text(value: unknown) {
	return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function cleanSourceId(value: string) {
	return value.replace(/^drafts\./, "");
}

export function stableSourceSort<T extends SanityCatalogDocumentSource>(left: T, right: T) {
	return compareOrdinal(text(left._id) ?? "", text(right._id) ?? "");
}

function validTimestamp(value: string | undefined) {
	return value !== undefined && Number.isFinite(Date.parse(value));
}

export function sourceMetadata(
	source: SanityCatalogDocumentSource,
	expectedType: SanityCatalogImportProduct["sourceType"],
	path: string,
	index: number,
	issues: SanityCatalogImportIssue[],
) {
	const rawSourceId = text(source._id);
	const sourceId = rawSourceId
		? cleanSourceId(rawSourceId)
		: `missing-${expectedType}-${index + 1}`;
	if (!rawSourceId) {
		issues.push(issue("missing-required-field", `${path}._id`, "Sanity source ID is required"));
	}
	if (source._type !== expectedType) {
		issues.push(
			issue(
				"unexpected-source-type",
				`${path}._type`,
				`Expected source type ${expectedType}`,
			),
		);
	}
	const sourceRevision = text(source._rev);
	if (!sourceRevision) {
		issues.push(
			issue("invalid-source-metadata", `${path}._rev`, "Sanity source revision is required"),
		);
	}
	const sourceCreatedAt = text(source._createdAt);
	if (!validTimestamp(sourceCreatedAt)) {
		issues.push(
			issue(
				"invalid-source-metadata",
				`${path}._createdAt`,
				"Sanity source creation timestamp must be valid",
			),
		);
	}
	const sourceUpdatedAt = text(source._updatedAt);
	if (!validTimestamp(sourceUpdatedAt)) {
		issues.push(
			issue(
				"invalid-source-metadata",
				`${path}._updatedAt`,
				"Sanity source update timestamp must be valid",
			),
		);
	}
	if (
		validTimestamp(sourceCreatedAt)
		&& validTimestamp(sourceUpdatedAt)
		&& Date.parse(sourceCreatedAt as string) > Date.parse(sourceUpdatedAt as string)
	) {
		issues.push(
			issue(
				"invalid-source-metadata",
				path,
				"Sanity source creation timestamp cannot be later than its update timestamp",
			),
		);
	}
	const productKey = `sanity.catalog.${sourceId}`;
	if (!PRODUCT_KEY_PATTERN.test(productKey)) {
		issues.push(
			issue(
				"invalid-source-metadata",
				`${path}._id`,
				"Sanity source ID cannot form a stable catalog product key",
			),
		);
	}
	return {
		sourceId,
		productKey,
		...(sourceRevision ? { sourceRevision } : {}),
		...(sourceCreatedAt ? { sourceCreatedAt } : {}),
		...(sourceUpdatedAt ? { sourceUpdatedAt } : {}),
	};
}

export function requiredText(
	value: unknown,
	path: string,
	label: string,
	issues: SanityCatalogImportIssue[],
) {
	const result = text(value);
	if (!result) {
		issues.push(issue("missing-required-field", path, `${label} is required`));
	}
	return result;
}

export function cents(value: unknown, path: string, issues: SanityCatalogImportIssue[]) {
	if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
		issues.push(issue("invalid-price", path, "Retail price must be a positive number"));
		return undefined;
	}
	const result = Math.round(value * 100);
	if (
		!Number.isSafeInteger(result)
		|| result > MAX_PRICE_CENTS
		|| Math.abs(result / 100 - value) > Number.EPSILON * Math.max(1, Math.abs(value)) * 4
	) {
		issues.push(
			issue("invalid-price", path, "Retail price must convert exactly to bounded USD cents"),
		);
		return undefined;
	}
	return result;
}

export function booleanDefault(
	value: unknown,
	fallback: boolean,
	field: string,
	normalizations: string[],
	path: string,
	issues: SanityCatalogImportIssue[],
) {
	if (typeof value === "boolean") return value;
	if (value !== undefined && value !== null) {
		issues.push(
			issue(
				"invalid-source-metadata",
				path,
				`${field} must be a boolean when present`,
			),
		);
	}
	normalizations.push(`${field}=${fallback}`);
	return fallback;
}

export function multiplierBasisPoints(
	value: unknown,
	normalizations: string[],
	path: string,
	issues: SanityCatalogImportIssue[],
) {
	if (typeof value === "number" && Number.isFinite(value) && value > 0) {
		const basisPoints = Math.round(value * 10_000);
		if (Number.isSafeInteger(basisPoints)) return basisPoints;
	}
	if (value !== undefined && value !== null) {
		issues.push(
			issue(
				"invalid-source-metadata",
				path,
				"Frame markup multiplier must be a positive number when present",
			),
		);
	}
	normalizations.push("frameMarkupMultiplier=2");
	return 20_000;
}

export function isValidFileReference(value: string) {
	return FILE_REF_PATTERN.test(value);
}

export function imagePlacement(
	image: SanityCatalogImageSource | undefined,
	options: {
		path: string;
		fallbackKey: string;
		requireSourceKey: boolean;
		role: SanityCatalogImportMediaPlacement["role"];
		order: number;
		printSource: boolean;
		requireAlt: boolean;
	},
	issues: SanityCatalogImportIssue[],
) {
	if (!image) return undefined;
	const sourceAssetRef = text(image.assetRef);
	if (!sourceAssetRef || !IMAGE_REF_PATTERN.test(sourceAssetRef)) {
		issues.push(
			issue(
				"invalid-image-reference",
				`${options.path}.assetRef`,
				"Image must contain a valid Sanity asset reference",
			),
		);
		return undefined;
	}
	const sourceKey = text(image._key);
	if (options.requireSourceKey && !sourceKey) {
		issues.push(
			issue(
				"missing-required-field",
				`${options.path}._key`,
				"Ordered image placement must preserve its Sanity key",
			),
		);
	}
	const altText = text(image.alt);
	if (options.requireAlt && !altText) {
		issues.push(
			issue(
				"missing-image-alt",
				`${options.path}.alt`,
				"Image needs owner-authored alternative text before publication",
				"warning",
			),
		);
	}
	return {
		key: sourceKey ?? options.fallbackKey,
		role: options.role,
		order: options.order,
		sourceAssetRef,
		...(altText ? { altText } : {}),
		printSource: options.printSource,
	} satisfies SanityCatalogImportMediaPlacement;
}

export function validatePlacementKeys(
	media: SanityCatalogImportMediaPlacement[],
	path: string,
	issues: SanityCatalogImportIssue[],
) {
	const keys = new Set<string>();
	for (const [index, placement] of media.entries()) {
		if (keys.has(placement.key)) {
			issues.push(
				issue(
					"duplicate-placement-key",
					`${path}[${index}].key`,
					"Catalog media placement keys must be unique per product",
				),
			);
		}
		keys.add(placement.key);
	}
}

export function sortedIssues(issues: SanityCatalogImportIssue[]) {
	return [...issues].sort(
		(left, right) =>
			compareOrdinal(left.path, right.path)
			|| compareOrdinal(left.code, right.code)
			|| compareOrdinal(left.message, right.message),
	);
}

function targetFieldIssue(
	product: SanityCatalogImportProduct,
	path: string,
	message: string,
) {
	product.issues.push(issue("invalid-target-field", path, message));
}

export function validateTargetFields(product: SanityCatalogImportProduct) {
	if (
		product.productKey.length > CATALOG_PRODUCT_LIMITS.productKey
		|| !PRODUCT_KEY_PATTERN.test(product.productKey)
	) {
		targetFieldIssue(
			product,
			`${product.sourcePath}._id`,
			"Normalized product key exceeds the target identity contract",
		);
	}
	if (product.title && product.title.length > CATALOG_PRODUCT_LIMITS.title) {
		targetFieldIssue(
			product,
			`${product.sourcePath}.title`,
			`Product title exceeds ${CATALOG_PRODUCT_LIMITS.title} characters`,
		);
	}
	if (
		product.slug
		&& (product.slug.length > CATALOG_PRODUCT_LIMITS.slug || !SLUG_PATTERN.test(product.slug))
	) {
		targetFieldIssue(
			product,
			`${product.sourcePath}.slug`,
			"Product slug exceeds the target lowercase URL-key contract",
		);
	}
	if (product.description && product.description.length > CATALOG_PRODUCT_LIMITS.description) {
		targetFieldIssue(
			product,
			`${product.sourcePath}.description`,
			`Product description exceeds ${CATALOG_PRODUCT_LIMITS.description} characters`,
		);
	}
	if (product.variants.length > CATALOG_PRODUCT_LIMITS.variantsPerRevision) {
		targetFieldIssue(
			product,
			`${product.sourcePath}.variants`,
			`Product exceeds ${CATALOG_PRODUCT_LIMITS.variantsPerRevision} variants`,
		);
	}
	if (
		product.printOptions
		&& (product.printOptions.framePriceMultiplierBasisPoints <= 0
			|| product.printOptions.framePriceMultiplierBasisPoints
				> CATALOG_PRODUCT_LIMITS.framePriceMultiplierBasisPoints)
	) {
		targetFieldIssue(
			product,
			`${product.sourcePath}.frameMarkupMultiplier`,
			"Frame markup multiplier exceeds the target pricing contract",
		);
	}
	for (const [index, variant] of product.variants.entries()) {
		if (
			variant.key.length > CATALOG_PRODUCT_LIMITS.variantKey
			|| !PRODUCT_KEY_PATTERN.test(variant.key)
		) {
			targetFieldIssue(
				product,
				`${product.sourcePath}.variants[${index}]._key`,
				"Variant key exceeds the target stable identity contract",
			);
		}
		for (const [field, value] of [
			["paper", variant.materialOptionKey],
			["size", variant.sizeOptionKey],
		] as const) {
			if (
				value
				&& (value.length > CATALOG_PRODUCT_LIMITS.optionKey || !OPTION_KEY_PATTERN.test(value))
			) {
				targetFieldIssue(
					product,
					`${product.sourcePath}.variants[${index}].${field}`,
					"Variant option exceeds the target lowercase option-key contract",
				);
			}
		}
	}
	for (const [index, placement] of product.media.entries()) {
		if (
			placement.key.length > CATALOG_PRODUCT_LIMITS.variantKey
			|| !PRODUCT_KEY_PATTERN.test(placement.key)
		) {
			targetFieldIssue(
				product,
				`${product.sourcePath}.media[${index}].key`,
				"Media placement key exceeds the target stable identity contract",
			);
		}
	}
	for (const [index, member] of (product.printSetMembers ?? []).entries()) {
		if (member.order !== index) {
			targetFieldIssue(
				product,
				`${product.sourcePath}.printSetMembers[${index}].order`,
				"Print-set member order must be contiguous",
			);
		}
		if (!product.media.some((placement) => placement.key === member.mediaPlacementKey)) {
			targetFieldIssue(
				product,
				`${product.sourcePath}.printSetMembers[${index}].mediaPlacementKey`,
				"Print-set member must reference its exact media placement",
			);
		}
	}
}
