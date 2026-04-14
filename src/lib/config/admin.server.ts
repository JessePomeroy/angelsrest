import type { AdminServerConfig } from "@jessepomeroy/admin";
import { getToken } from "@mmailaender/convex-better-auth-svelte/sveltekit";
import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { adminConfig } from "./admin";

export const adminServerConfig: AdminServerConfig = {
	...adminConfig,
	galleryWorkerUrl:
		privateEnv.GALLERY_WORKER_URL ?? "https://gallery-worker.thinkingofview.workers.dev",
	galleryAdminSecret: privateEnv.GALLERY_ADMIN_SECRET ?? "",
	convexUrl: publicEnv.PUBLIC_CONVEX_URL ?? "",
	resendApiKey: privateEnv.RESEND_API_KEY ?? "",
	getConvexToken: async (request) => {
		const cookieHeader = request.headers.get("cookie") ?? "";
		const cookies = Object.fromEntries(
			cookieHeader.split("; ").map((c) => {
				const [name, ...rest] = c.split("=");
				return [name, rest.join("=")];
			}),
		);
		return getToken({ get: (name: string) => cookies[name] }) ?? null;
	},
};
