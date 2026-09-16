import type { AdminAuthClient } from "@jessepomeroy/admin";
import { readable } from "svelte/store";

const phase = new URLSearchParams(window.location.search).get("session");
const refused = async () => ({ error: { message: "Simulated authentication failure; no provider was contacted." } });
export const authClient = {
	signIn: { email: refused, social: refused }, signUp: { email: refused },
	signOut: refused, changePassword: refused,
	useSession: () => readable({ data: phase === "signed-out" ? null : { user: { email: "designer@example.invalid" } }, isPending: phase === "loading" }),
	convex: { token: async () => ({ data: { token: null } }) },
} satisfies AdminAuthClient & { convex: { token: () => Promise<{ data: { token: null } }> } };

export function reloadAdminRoot() {
	// Observe the real recovery button without leaving the isolated preview.
	document.documentElement.dataset.handbookReloadRequested = "true";
}
