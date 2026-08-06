import Stripe from "stripe";
import { env } from "$env/dynamic/private";
import { STRIPE_API_VERSION } from "$lib/server/stripeApiVersion";

let _stripe: Stripe | null = null;

/**
 * Lazy singleton Stripe client. Call sites used to `new Stripe(...)` at module
 * top-level, which fires a constructor per imported module and allocates
 * duplicate HTTP agents. Audit M3 consolidates those into one shared instance.
 */
export function getStripe(): Stripe {
	if (!_stripe) {
		if (!env.STRIPE_SECRET_KEY) throw new Error("Stripe is not configured");
		_stripe = new Stripe(env.STRIPE_SECRET_KEY, { apiVersion: STRIPE_API_VERSION });
	}
	return _stripe;
}
