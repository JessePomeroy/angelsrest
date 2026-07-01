import type { AdminServerConfig } from "@jessepomeroy/admin";
import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import type { Cookies } from "@sveltejs/kit";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { requireAuth } from "$lib/server/adminAuth";
import { getGalleryWorkerUrl } from "$lib/server/galleryWorkerUrl";
import { adminConfig } from "./admin";

function cookiesFromRequest(request: Request): Cookies {
	const cookieHeader = request.headers.get("cookie") ?? "";
	const cookies = Object.fromEntries(
		cookieHeader
			.split(";")
			.map((cookie) => cookie.trim())
			.filter(Boolean)
			.map((cookie) => {
				const [name, ...rest] = cookie.split("=");
				return [name, rest.join("=")];
			}),
	);
	return { get: (name: string) => cookies[name] } as Cookies;
}

export const adminServerConfig: AdminServerConfig = {
	...adminConfig,
	galleryWorkerUrl: getGalleryWorkerUrl(),
	galleryAdminSecret: privateEnv.GALLERY_ADMIN_SECRET ?? "",
	convexUrl: publicEnv.PUBLIC_CONVEX_URL ?? "",
	resendApiKey: privateEnv.RESEND_API_KEY ?? "",
	verifyAdmin: async (request) => {
		await requireAuth(cookiesFromRequest(request));
		return true;
	},
	getConvexToken: async (request) => {
		return getToken(cookiesFromRequest(request)) ?? null;
	},
};
