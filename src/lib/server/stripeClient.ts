import Stripe from "stripe";
import { getStripeSecretKey } from "$lib/server/runtimeConfig";
import { STRIPE_API_VERSION } from "$lib/server/stripeApiVersion";

let _stripe: Stripe | null = null;

/**
 * Lazy singleton Stripe client. Call sites used to `new Stripe(...)` at module
 * top-level, which fires a constructor per imported module and allocates
 * duplicate HTTP agents. Audit M3 consolidates those into one shared instance.
 */
export function getStripe(): Stripe {
	if (!_stripe) {
		_stripe = new Stripe(getStripeSecretKey(), { apiVersion: STRIPE_API_VERSION });
	}
	return _stripe;
}
