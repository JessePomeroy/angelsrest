import { catalogShop } from "$lib/server/catalogShop.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params, locals }) =>
	catalogShop.loadPrintSet(params.slug, locals.isPreview);
