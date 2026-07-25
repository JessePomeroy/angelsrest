import { v } from "convex/values";
import type { Doc } from "../_generated/dataModel";
import type { QueryCtx } from "../_generated/server";
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

export function requireCatalogProductKinds(
	client: Doc<"platformClients">,
) {
	const enabledKinds = client.catalogProductKinds;
	if (!enabledKinds) {
		throw new Error("Catalog product policy is not configured for this site");
	}
	return normalizeCatalogProductKinds(enabledKinds);
}

export async function loadCatalogProductKinds(ctx: QueryCtx, siteUrl: string) {
	const client = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (query) => query.eq("siteUrl", siteUrl))
		.unique();
	if (!client) throw new Error("Catalog product policy site does not exist");
	return requireCatalogProductKinds(client);
}

export function requireCatalogProductKindEnabled(
	client: Doc<"platformClients">,
	productKind: CatalogProductKind,
) {
	if (!requireCatalogProductKinds(client).includes(productKind)) {
		throw new Error(`Catalog ${productKind} products are not enabled for this site`);
	}
}
