import { setServerConfig } from "@jessepomeroy/admin/server";
import type { Cookies } from "@sveltejs/kit";
import { adminServerConfig } from "$lib/config/admin.server";
import { requireAuth } from "$lib/server/adminAuth";

setServerConfig(adminServerConfig);

type AdminEvent = { cookies: Cookies };
type AdminHandler<TEvent> = (event: TEvent) => Response | Promise<Response>;

export function withAdminAuth<TEvent>(handler: AdminHandler<TEvent>) {
	return async (event: TEvent & AdminEvent) => {
		await requireAuth(event.cookies);
		return handler(event);
	};
}
