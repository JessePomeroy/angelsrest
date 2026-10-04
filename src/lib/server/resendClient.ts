import { Resend, type Response as ResendResponse } from "resend";
import { env } from "$env/dynamic/private";
import {
	getResendApiKey,
	isStagingEnvironment,
	RuntimeConfigurationError,
} from "$lib/server/runtimeConfig";

let _resend: Resend | null = null;

/** Every request made by this client is confined to Resend's test recipient. */
class StagingResend extends Resend {
	override fetchRequest<T>(path: string, options: RequestInit = {}): Promise<ResendResponse<T>> {
		if (path !== "/emails" || options.method !== "POST" || typeof options.body !== "string") {
			throw new RuntimeConfigurationError("Staging email transport");
		}
		const payload: unknown = JSON.parse(options.body);
		if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
			throw new RuntimeConfigurationError("Staging email transport");
		}
		return super.fetchRequest<T>(path, {
			...options,
			body: JSON.stringify({
				...payload,
				from: "Angel's Rest staging <staging@angelsrest.online>",
				to: ["delivered@resend.dev"],
				cc: undefined,
				bcc: undefined,
				reply_to: undefined,
			}),
		});
	}
}

/**
 * Lazy singleton Resend client. Mirrors `stripeClient.getStripe` —
 * consolidates the per-route `new Resend(...)` constructors into one shared
 * instance. See audit M3.
 */
export function getResend(): Resend {
	if (!_resend) {
		if (isStagingEnvironment()) {
			if (!env.STAGING_RESEND_API_KEY?.trim()) {
				throw new RuntimeConfigurationError("Staging email");
			}
			_resend = new StagingResend(env.STAGING_RESEND_API_KEY);
		} else {
			_resend = new Resend(getResendApiKey());
		}
	}
	return _resend;
}
