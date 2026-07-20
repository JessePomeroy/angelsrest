import {
	type CatalogProductGraphV2Draft,
	validateCatalogProductGraphV2Draft,
} from "./catalogProductGraphValidators";

export const CATALOG_PRODUCT_GRAPH_V2_CHECKSUM_PREFIX =
	"catalog-product-graph:v2:";

export const CATALOG_PRODUCT_GRAPH_V2_WEB_MEDIA_ROLES = [
	"primary",
	"cover",
	"gallery",
	"set_member",
	"social_share",
] as const;

type WebMediaRole =
	(typeof CATALOG_PRODUCT_GRAPH_V2_WEB_MEDIA_ROLES)[number];

export function canonicalizeCatalogProductGraphV2WebMedia(
	webMedia: CatalogProductGraphV2Draft["webMedia"],
) {
	const roleOrder = new Map<WebMediaRole, number>(
		CATALOG_PRODUCT_GRAPH_V2_WEB_MEDIA_ROLES.map((role, index) => [
			role,
			index,
		]),
	);
	return [...webMedia].sort((left, right) =>
		(roleOrder.get(left.role) ?? CATALOG_PRODUCT_GRAPH_V2_WEB_MEDIA_ROLES.length)
			- (roleOrder.get(right.role)
				?? CATALOG_PRODUCT_GRAPH_V2_WEB_MEDIA_ROLES.length)
		|| left.order - right.order
		|| left.key.localeCompare(right.key),
	);
}

export function canonicalizeCatalogProductGraphV2Draft(
	draft: CatalogProductGraphV2Draft,
) {
	return validateCatalogProductGraphV2Draft({
		...draft,
		webMedia: canonicalizeCatalogProductGraphV2WebMedia(draft.webMedia),
	} as CatalogProductGraphV2Draft);
}

/** A fixed-field serialization that cannot vary with caller object-key order. */
export function serializeCatalogProductGraphV2Draft(
	draft: CatalogProductGraphV2Draft,
) {
	const validated = canonicalizeCatalogProductGraphV2Draft(draft);
	const common = {
		schemaVersion: 2,
		productKind: validated.productKind,
		title: validated.title ?? null,
		slug: validated.slug ?? null,
		description: validated.description ?? null,
		seoDescription: validated.seoDescription ?? null,
		currency: "usd",
		fulfillmentMode: validated.fulfillmentMode,
		saleAvailability: validated.saleAvailability,
		shopPlacement: {
			featured: validated.shopPlacement.featured,
			orderRank: validated.shopPlacement.orderRank ?? null,
		},
		variants: validated.variants.map((variant) => ({
			key: variant.key,
			order: variant.order,
			materialOptionKey: variant.materialOptionKey ?? null,
			sizeOptionKey: variant.sizeOptionKey ?? null,
			retailPriceCents: variant.retailPriceCents ?? null,
			status: variant.status,
		})),
		webMedia: validated.webMedia.map((placement) => ({
			key: placement.key,
			order: placement.order,
			role: placement.role,
			assetId: placement.assetId,
			altText: placement.altText ?? null,
		})),
	};

	if (validated.productKind === "print") {
		return `${CATALOG_PRODUCT_GRAPH_V2_CHECKSUM_PREFIX}${JSON.stringify({
			...common,
			printOptions: {
				borderOptionsEnabled: validated.printOptions.borderOptionsEnabled,
				frameOptionsEnabled: validated.printOptions.frameOptionsEnabled,
				framePriceMultiplierBasisPoints:
					validated.printOptions.framePriceMultiplierBasisPoints,
			},
			printSources: validated.printSources.map((source) => ({
				key: source.key,
				order: source.order,
				assetId: source.assetId,
			})),
		})}`;
	}
	if (validated.productKind === "print_set") {
		return `${CATALOG_PRODUCT_GRAPH_V2_CHECKSUM_PREFIX}${JSON.stringify({
			...common,
			printOptions: {
				borderOptionsEnabled: validated.printOptions.borderOptionsEnabled,
				frameOptionsEnabled: validated.printOptions.frameOptionsEnabled,
				framePriceMultiplierBasisPoints:
					validated.printOptions.framePriceMultiplierBasisPoints,
			},
			printSources: validated.printSources.map((source) => ({
				key: source.key,
				order: source.order,
				assetId: source.assetId,
			})),
			setMembers: validated.setMembers.map((member) => ({
				key: member.key,
				order: member.order,
				mediaPlacementKey: member.mediaPlacementKey,
				printSourceKey: member.printSourceKey,
			})),
		})}`;
	}
	if (validated.productKind === "digital_download") {
		return `${CATALOG_PRODUCT_GRAPH_V2_CHECKSUM_PREFIX}${JSON.stringify({
			...common,
			paidFile: validated.paidFile
				? {
					key: validated.paidFile.key,
					assetId: validated.paidFile.assetId,
					version: validated.paidFile.version ?? null,
				}
				: null,
		})}`;
	}
	return `${CATALOG_PRODUCT_GRAPH_V2_CHECKSUM_PREFIX}${JSON.stringify(common)}`;
}

export async function checksumCatalogProductGraphV2Draft(
	draft: CatalogProductGraphV2Draft,
) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(serializeCatalogProductGraphV2Draft(draft)),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}
