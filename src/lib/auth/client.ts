import { convexClient } from "@convex-dev/better-auth/client/plugins";
import { createAuthClient } from "better-auth/svelte";
import { browser } from "$app/environment";

function createClient() {
	return createAuthClient({
		baseURL: browser ? window.location.origin : "http://localhost",
		plugins: [convexClient()],
	});
}

export const authClient = createClient();
