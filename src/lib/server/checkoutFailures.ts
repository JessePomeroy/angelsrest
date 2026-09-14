import type { CatalogBoundaryPhase } from "$lib/server/catalogCommerceClients";

export type CurrentCheckoutCommercePhase =
	| CatalogBoundaryPhase
	| "query"
	| "graph"
	| "resolver"
	| "authority";

export type CurrentCheckoutFailureKind = "selection_changed" | "unavailable" | "invalid_authority";

export const CHECKOUT_SELECTION_CHANGED_MESSAGE =
	"This product's options changed. Refresh the page and choose it again before checkout.";
export const CHECKOUT_UNAVAILABLE_MESSAGE =
	"Checkout is temporarily unavailable. Please try again.";
export const CHECKOUT_FAILED_MESSAGE = "Checkout failed. Please try again.";

const SAFE_MESSAGES: Record<CurrentCheckoutFailureKind, string> = {
	selection_changed: CHECKOUT_SELECTION_CHANGED_MESSAGE,
	unavailable: CHECKOUT_UNAVAILABLE_MESSAGE,
	invalid_authority: CHECKOUT_FAILED_MESSAGE,
};

export class CurrentCheckoutCommerceError extends Error {
	readonly stage = "checkout_catalog" as const;

	constructor(
		readonly kind: CurrentCheckoutFailureKind,
		readonly phase: CurrentCheckoutCommercePhase,
	) {
		super(SAFE_MESSAGES[kind]);
		this.name = "CurrentCheckoutCommerceError";
	}
}

export type CheckoutSessionFailureStage =
	| "checkout_snapshot"
	| "checkout_admission"
	| "checkout_tenant"
	| "checkout_stripe"
	| "checkout_internal";

export class CheckoutSessionStageError extends Error {
	constructor(
		readonly stage: CheckoutSessionFailureStage,
		cause: unknown,
	) {
		super(cause instanceof Error ? cause.message : CHECKOUT_FAILED_MESSAGE, { cause });
		this.name = "CheckoutSessionStageError";
	}
}

export async function runCheckoutSessionStage<T>(
	stage: CheckoutSessionFailureStage,
	operation: () => T | Promise<T>,
): Promise<T> {
	try {
		return await operation();
	} catch (cause) {
		if (cause instanceof CheckoutSessionStageError) throw cause;
		throw new CheckoutSessionStageError(stage, cause);
	}
}
