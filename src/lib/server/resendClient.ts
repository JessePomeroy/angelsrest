import { Resend } from "resend";
import { env } from "$env/dynamic/private";

let _resend: Resend | null = null;

/**
 * Lazy singleton Resend client. Mirrors `stripeClient.getStripe` —
 * consolidates the per-route `new Resend(...)` constructors into one shared
 * instance. See audit M3.
 */
export function getResend(): Resend {
	if (!_resend) {
		if (!env.RESEND_API_KEY) {
			throw new Error("RESEND_API_KEY is not configured");
		}
		_resend = new Resend(env.RESEND_API_KEY);
	}
	return _resend;
}
