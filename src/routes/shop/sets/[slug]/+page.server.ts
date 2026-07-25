import { sanityShop } from "$lib/server/sanityShop.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ params, locals }) =>
	sanityShop.loadPrintSet(params.slug, locals.isPreview);
