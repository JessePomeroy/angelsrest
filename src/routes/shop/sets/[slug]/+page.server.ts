import { convexShop } from "$lib/server/current/convexShop.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = async ({ params, parent, url }) => {
	const preview = url.searchParams.has("draftPreview") ? (await parent()).draftPreview : null;
	if (preview?.kind === "product" && "printSet" in preview.product) return preview.product;
	return convexShop.loadPrintSet(params.slug);
};
