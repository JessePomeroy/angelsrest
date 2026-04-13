/**
 * SvelteKit client hooks (audit #50a).
 *
 * Initializes Sentry on the browser side and routes uncaught client errors
 * through Sentry.handleErrorWithSentry. Safe no-op when PUBLIC_SENTRY_DSN
 * is empty.
 */

import * as Sentry from "@sentry/sveltekit";
import { env } from "$env/dynamic/public";

Sentry.init({
	dsn: env.PUBLIC_SENTRY_DSN,
	initialScope: {
		tags: { site: "angelsrest" },
	},
	tracesSampleRate: 0,
	sendDefaultPii: false,
});

const sentryHandleError = Sentry.handleErrorWithSentry();

export const handleError: typeof sentryHandleError = (input) => {
	const msg = input.error instanceof Error ? input.error.message : "";
	if (msg.includes("Failed to fetch dynamically imported module")) {
		// After a deploy, old chunk hashes no longer exist on the server.
		// A full reload lets the browser fetch the current entry point.
		window.location.reload();
		return;
	}
	return sentryHandleError(input);
};
