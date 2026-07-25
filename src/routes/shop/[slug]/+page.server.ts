import { catalogShop } from "$lib/server/catalogShop.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params, locals }) =>
	catalogShop.loadProduct(params.slug, locals.isPreview);
