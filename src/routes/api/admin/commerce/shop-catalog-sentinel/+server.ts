import { error, json } from "@sveltejs/kit";
import { readConvexShopRuntimeSentinel } from "$lib/server/convexShop.server";
import { authorizeR4ReadRequest, r4ReadPurposes } from "$lib/server/r4ReadAuthorization";

export async function GET({ request }: { request: Request }) {
	if (!(await authorizeR4ReadRequest(request, r4ReadPurposes.shopCatalogSentinel))) {
		throw error(401, "Unauthorized");
	}
	const runtimeResult = await Promise.allSettled([readConvexShopRuntimeSentinel()]);
	const runtime =
		runtimeResult[0]?.status === "fulfilled"
			? runtimeResult[0].value
			: {
					outcome: "unavailable" as const,
					publishedProductCount: null,
					productIndexCount: null,
					printSetIndexCount: null,
					collectionIndexCount: 0,
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
				preview: "unsupported",
			},
			runtime,
		},
		{
			status: runtime.outcome === "healthy" ? 200 : 503,
			headers: { "cache-control": "no-store" },
		},
	);
}
