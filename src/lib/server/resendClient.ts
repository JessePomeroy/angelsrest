import { Resend } from "resend";
import { RESEND_API_KEY } from "$env/static/private";

let _resend: Resend | null = null;

/**
 * Lazy singleton Resend client. Mirrors `stripeClient.getStripe` —
 * consolidates the per-route `new Resend(...)` constructors into one shared
 * instance. See audit M3.
 */
export function getResend(): Resend {
	if (!_resend) _resend = new Resend(RESEND_API_KEY);
	return _resend;
}
