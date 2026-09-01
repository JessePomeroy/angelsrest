import { error, json } from "@sveltejs/kit";
import { env } from "$env/dynamic/private";
import { parseCatalogProviderMode, readShopCatalogSentinel } from "$lib/server/catalogShop.server";
import { readConvexShopRuntimeSentinel } from "$lib/server/convexShop.server";
import { authorizeR4ReadRequest, r4ReadPurposes } from "$lib/server/r4ReadAuthorization";

export async function GET({ request }: { request: Request }) {
	if (!(await authorizeR4ReadRequest(request, r4ReadPurposes.shopCatalogSentinel))) {
		throw error(401, "Unauthorized");
	}
	const [runtimeResult, parityResult] = await Promise.allSettled([
		readConvexShopRuntimeSentinel(),
		readShopCatalogSentinel({ deadlineMs: 750 }),
	]);
	const runtime =
		runtimeResult.status === "fulfilled"
			? runtimeResult.value
			: {
					outcome: "unavailable" as const,
					publishedProductCount: null,
					productIndexCount: null,
					printSetIndexCount: null,
					collectionIndexCount: 0,
				};
	const legacySanityParity =
		parityResult.status === "fulfilled"
			? parityResult.value
			: {
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
				};
	return json(
		{
			version: 2,
			outcome: runtime.outcome,
			shopCatalogProvider: "convex",
			activePublishedProvider: "convex",
			scope: {
				classification: "convex_only",
				authority: "published_non_preview_product_graph",
				productIndex: "convex",
				productDetail: "convex",
				printSetIndex: "convex",
				printSetDetail: "convex",
				printCollectionDetail: "retired_404",
				collections: "none",
				preview: "ignored",
			},
			runtime,
			diagnostics: {
				legacyProviderConfiguration: {
					provider: parseCatalogProviderMode(env.SHOP_CATALOG_PROVIDER),
					configuration: catalogConfiguration(env.SHOP_CATALOG_PROVIDER),
				},
				legacySanityParity,
			},
		},
		{
			status: runtime.outcome === "healthy" ? 200 : 503,
			headers: { "cache-control": "no-store" },
		},
	);
}

function catalogConfiguration(value: unknown) {
	if (value === undefined) return "absent";
	return value === "sanity" || value === "shadow" || value === "convex" ? "exact" : "invalid";
}
