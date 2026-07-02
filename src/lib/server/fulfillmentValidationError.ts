/**
 * Local validation failure for data we are about to submit to LumaPrints.
 *
 * These are permanent fulfillment failures: retrying the Stripe webhook will
 * not create missing shipping data or repair malformed checkout metadata.
 */
export class FulfillmentValidationError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "FulfillmentValidationError";
	}
}
