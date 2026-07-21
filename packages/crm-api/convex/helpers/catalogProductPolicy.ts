import { v } from "convex/values";
import {
	type CatalogProductKind,
	catalogProductKindValidator,
} from "./catalogProductValidators";

export const catalogProductKindsValidator = v.array(catalogProductKindValidator);

export const CATALOG_PRODUCT_KIND_ORDER = [
	"print",
	"print_set",
	"postcard",
	"tapestry",
	"digital_download",
	"merchandise",
] as const satisfies readonly CatalogProductKind[];

const CATALOG_PRODUCT_KIND_SET = new Set<string>(CATALOG_PRODUCT_KIND_ORDER);

/**
 * Validate and canonically order one site's catalog capability policy.
 *
 * An empty array is an explicit deny-all policy. A missing policy remains
 * distinct so the staged rollout can fail closed after existing rows are
 * backfilled.
 */
export function normalizeCatalogProductKinds(
	productKinds: readonly CatalogProductKind[],
): CatalogProductKind[] {
	const requested = new Set<CatalogProductKind>();
	for (const productKind of productKinds) {
		if (!CATALOG_PRODUCT_KIND_SET.has(productKind)) {
			throw new Error(`Unsupported catalog product kind: ${productKind}`);
		}
		if (requested.has(productKind)) {
			throw new Error(`Duplicate catalog product kind: ${productKind}`);
		}
		requested.add(productKind);
	}
	return CATALOG_PRODUCT_KIND_ORDER.filter((productKind) =>
		requested.has(productKind)
	);
}
