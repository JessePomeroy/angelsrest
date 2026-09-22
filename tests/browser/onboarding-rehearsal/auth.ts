import type { AdminAuthClient } from "@jessepomeroy/admin";
import { readable } from "svelte/store";
import { currentClient, page, persist, practice } from "./state.svelte";
export const practicePassword = "practice-only";
const refused = async () => ({ error: { message: "Use the displayed practice email and password. No real authentication provider is connected." } });
export const authClient: AdminAuthClient = {
	signIn: {
		email: async ({ email, password }) => {
			const client = currentClient();
			if (!client || email.trim().toLowerCase() !== client.email || password !== practicePassword) return refused();
			practice.signedInEmail = client.email;
			persist();
			return {};
		},
		social: refused,
	},
	signUp: { email: refused },
	signOut: async () => { practice.signedInEmail = null; persist(); window.location.reload(); return {}; },
	changePassword: refused,
	useSession: () => readable({ data: { user: { email: page.url.pathname.startsWith("/admin") || page.url.pathname === "/" ? "operator@angelsrest.example" : practice.signedInEmail ?? "operator@angelsrest.example" } }, isPending: false }),
};
