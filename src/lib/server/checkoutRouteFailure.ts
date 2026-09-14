import { ApiErrorCode, apiError } from "$lib/server/apiError";
import {
	CHECKOUT_FAILED_MESSAGE,
	CheckoutSessionStageError,
	CurrentCheckoutCommerceError,
} from "$lib/server/checkoutFailures";
import { logStructured } from "$lib/server/logger";

type CheckoutRouteLogger = typeof logStructured;

export function throwCheckoutRouteFailure(
	error: unknown,
	event: "checkout" | "cart_checkout",
	log: CheckoutRouteLogger = logStructured,
): never {
	if (error instanceof CurrentCheckoutCommerceError) {
		const level = error.kind === "selection_changed" ? "warn" : "error";
		log({
			event: `${event}.failed`,
			level,
			stage: error.stage,
			...(level === "error" ? { error } : {}),
			meta: { failureKind: error.kind, failurePhase: error.phase },
		});
		if (error.kind === "selection_changed") {
			throw apiError(409, ApiErrorCode.CONFLICT, error.message);
		}
		if (error.kind === "unavailable") {
			throw apiError(503, ApiErrorCode.UNAVAILABLE, error.message);
		}
		throw apiError(500, ApiErrorCode.UPSTREAM_FAILED, error.message);
	}

	const staged =
		error instanceof CheckoutSessionStageError
			? error
			: new CheckoutSessionStageError("checkout_internal", error);
	log({
		event: `${event}.failed`,
		level: "error",
		stage: staged.stage,
		error: staged,
	});
	throw apiError(500, ApiErrorCode.UPSTREAM_FAILED, CHECKOUT_FAILED_MESSAGE);
}
