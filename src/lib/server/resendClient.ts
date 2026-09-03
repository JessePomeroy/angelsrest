import { Resend } from "resend";
import { getResendApiKey } from "$lib/server/runtimeConfig";

let _resend: Resend | null = null;

/**
 * Lazy singleton Resend client. Mirrors `stripeClient.getStripe` —
 * consolidates the per-route `new Resend(...)` constructors into one shared
 * instance. See audit M3.
 */
export function getResend(): Resend {
	if (!_resend) _resend = new Resend(getResendApiKey());
	return _resend;
}
