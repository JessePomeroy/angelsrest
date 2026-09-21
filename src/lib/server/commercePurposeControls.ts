import { env } from "$env/dynamic/private";
import { normalizeCommerceTenantSiteUrl } from "$lib/server/stripeConnect";

import {
	type CommerceControlDecision,
	parseCommerceControlRegistry,
} from "../../../packages/crm-api/convex/helpers/commercePurposeControl";

export type {
	CommerceControlDecision,
	CommerceControlState,
} from "../../../packages/crm-api/convex/helpers/commercePurposeControl";

export class NewOrderCheckoutClosedError extends Error {
	constructor() {
		super("New order Checkout is closed");
		this.name = "NewOrderCheckoutClosedError";
	}
}

export function newOrderCheckoutDecision(
	siteUrl: string,
	rawValue = env.NEW_ORDER_CHECKOUT_CONTROL,
): CommerceControlDecision {
	return parseCommerceControlRegistry(rawValue, normalizeCommerceTenantSiteUrl(siteUrl));
}

export function assertNewOrderCheckoutOpen(
	siteUrl: string,
	rawValue = env.NEW_ORDER_CHECKOUT_CONTROL,
) {
	const decision = newOrderCheckoutDecision(siteUrl, rawValue);
	if (!decision.valid || decision.state !== "open" || decision.generation === null) {
		throw new NewOrderCheckoutClosedError();
	}
	return {
		state: "open" as const,
		generation: decision.generation,
		...(decision.tenantId ? { tenantId: decision.tenantId } : {}),
	};
}
