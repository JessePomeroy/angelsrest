import { convexShop } from "$lib/server/convexShop.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => convexShop.loadIndex();
