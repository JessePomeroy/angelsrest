import { sanityShop } from "$lib/server/sanityShop.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => sanityShop.loadIndex(locals.isPreview);
