import { toId } from "@jessepomeroy/admin";
import { getFunctionName } from "convex/server";
import { ConvexError } from "convex/values";
import { normalizePlatformClientInput, PLATFORM_CLIENT_SITE_IN_USE } from "../../../packages/crm-api/convex/helpers/platformClientInput";
import { persist, practice } from "./state.svelte";

type Ref = Parameters<typeof getFunctionName>[0];
type Args = Record<string, unknown>;
function query(ref: Ref) {
	const name = getFunctionName(ref);
	if (name === "platform:listAll") return practice.clients;
	throw new Error(`This rehearsal does not include ${name}.`);
}
export function useQuery(ref: Ref) {
	const data = $derived(query(ref));
	return { get data() { return data; }, isLoading: false, error: undefined };
}
export function useConvexClient() {
	return {
		async query(ref: Ref) { return query(ref); },
		async mutation(ref: Ref, args: Args) {
			if (getFunctionName(ref) !== "platform:createClient") throw new Error("This rehearsal only saves fictional new-client records.");
			if (typeof args.name !== "string" || typeof args.email !== "string" || typeof args.siteUrl !== "string"
				|| !Array.isArray(args.adminEmails) || !args.adminEmails.every((email): email is string => typeof email === "string")
				|| (args.tier !== "basic" && args.tier !== "full")) throw new Error("Invalid practice client.");
			const input = normalizePlatformClientInput({ name: args.name, email: args.email, siteUrl: args.siteUrl, adminEmails: args.adminEmails });
			if (!input.siteUrl.endsWith(".example") || !input.email.endsWith(".example")) {
				throw new Error("Use fictional .example domains and email addresses in this rehearsal.");
			}
			if (practice.clients.some(client => client.siteUrl === input.siteUrl)) throw new ConvexError(PLATFORM_CLIENT_SITE_IN_USE);
			const id = toId<"platformClients">(`practice-${crypto.randomUUID()}`);
			practice.clients.push({ ...input, _id: id, _creationTime: Date.now(), tier: args.tier, role: "client", subscriptionStatus: "none" });
			persist();
			return id;
		},
		async action() { throw new Error("Provider actions are not enabled in this rehearsal."); },
	};
}
export function setupConvex() {}
export function setupAuth() {}

export function usePaginatedQuery() { throw new Error("Pagination is outside this onboarding rehearsal."); }
