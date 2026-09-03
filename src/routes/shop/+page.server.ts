import { convexShop } from "$lib/server/current/convexShop.server";
import type { PageServerLoad } from "./$types";

export const load: PageServerLoad = () => convexShop.loadIndex();
