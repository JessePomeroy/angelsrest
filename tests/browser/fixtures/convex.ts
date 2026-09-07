// Fail closed: interaction fixtures must never write to a provider.
export function setupConvex(_url: string) {}
export function useConvexClient() {
	return {
		async mutation() {
			throw new Error("Unexpected Convex mutation in browser fixture");
		},
	};
}
export { api } from "../../../packages/crm-api/convex/_generated/api";

export function useQuery() {
	throw new Error("Unexpected Convex query in browser fixture");
}
