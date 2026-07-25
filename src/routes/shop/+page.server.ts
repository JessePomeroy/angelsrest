import { catalogShop } from "$lib/server/catalogShop.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = ({ locals }) => catalogShop.loadIndex(locals.isPreview);
