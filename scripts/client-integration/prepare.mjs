import { isDeepStrictEqual } from "node:util";
import { createSetupPlan } from "./plan.mjs";

/** Bind the reviewed local plan before handing its public intent to the operator UI. */
export function prepareClientSetup(contract, root, environmentId, env, reviewedPlan) {
	const current = createSetupPlan(contract, root, environmentId, env);
	if (!isDeepStrictEqual(reviewedPlan, current)) {
		throw new Error("The reviewed setup plan is stale or differs from the current target.");
	}
	return {
		version: 1,
		kind: "client-setup",
		identity: { ...current.identity },
		target: {
			publicOrigin: current.target.publicOrigin,
			convexUrl: current.target.convexUrl,
			convexSiteUrl: current.target.convexSiteUrl,
		},
	};
}
