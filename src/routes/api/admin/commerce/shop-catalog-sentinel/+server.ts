import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { parseCatalogProviderMode, readShopCatalogSentinel } from "$lib/server/catalogShop.server";
import { authorizeR4ReadRequest, r4ReadPurposes } from "$lib/server/r4ReadAuthorization";

export async function GET({ request }: { request: Request }) {
	if (!(await authorizeR4ReadRequest(request, r4ReadPurposes.shopCatalogSentinel))) {
		throw error(401, "Unauthorized");
	}
	const configured = parseCatalogProviderMode(env.SHOP_CATALOG_PROVIDER);
	const configuration = catalogConfiguration(env.SHOP_CATALOG_PROVIDER);
	const activePublishedProvider = configured === "convex" ? "convex" : "sanity";
	const catalog = await readShopCatalogSentinel().catch(() => ({
		outcome: "unavailable" as const,
		sanityCount: null,
		convexCount: null,
		distribution: "unavailable" as const,
		publicAdapterValidation: "unavailable" as const,
		commerceParity: "unavailable" as const,
		presentationParity: "unavailable" as const,
		presentationMismatchCounts: null,
		sanityPrintSetCoverFallbackCount: null,
		transferEquivalentDimensionCount: null,
		associationParity: "unavailable" as const,
		productIndexOrder: "unavailable" as const,
		printSetOrder: "unavailable" as const,
	}));
	const outcome =
		catalog.outcome === "unavailable"
			? "unavailable"
			: configuration === "exact" && catalog.outcome === "exact"
				? "exact"
				: "mismatch";
	return json(
		{
			version: 1,
			outcome,
			shopCatalogProvider: configured,
			shopCatalogConfiguration: configuration,
			activePublishedProvider,
			scope: {
				classification: configured === "convex" ? "hybrid" : "sanity_only",
				authority: "published_non_preview_product_graph",
				productIndex: activePublishedProvider,
				productDetail: activePublishedProvider,
				printSetIndex: activePublishedProvider,
				printSetDetail: activePublishedProvider,
				printCollectionDetail: "sanity",
				collections: "sanity",
				preview: "sanity",
			},
			catalog,
		},
		{
			status: outcome === "exact" ? 200 : outcome === "mismatch" ? 409 : 503,
			headers: { "cache-control": "no-store" },
		},
	);
}

function catalogConfiguration(value: unknown) {
	if (value === undefined) return "absent";
	return value === "sanity" || value === "shadow" || value === "convex" ? "exact" : "invalid";
}
