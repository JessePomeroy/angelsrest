/**
 * SvelteKit client hooks (audit #50a).
 *
 * Initializes Sentry on the browser side and routes uncaught client errors
 * through Sentry.handleErrorWithSentry. Safe no-op when PUBLIC_SENTRY_DSN
 * is empty.
 */

import { handleErrorWithSentry, init } from "@sentry/sveltekit";
import { env } from "$env/dynamic/public";

init({
	dsn: env.PUBLIC_SENTRY_DSN,
	initialScope: {
		tags: { site: "angelsrest" },
	},
	tracesSampleRate: 0,
	sendDefaultPii: false,
});

const sentryHandleError = handleErrorWithSentry();

export const handleError: typeof sentryHandleError = (
	input: Parameters<typeof sentryHandleError>[0],
) => {
	const msg = input.error instanceof Error ? input.error.message : "";
	if (msg.includes("Failed to fetch dynamically imported module")) {
		// After a deploy, old chunk hashes no longer exist on the server.
		// A full reload lets the browser fetch the current entry point.
		window.location.reload();
		return;
	}
	// eslint-disable-next-line @typescript-eslint/no-explicit-any -- Sentry types expect server RequestEvent, but client passes NavigationEvent
	return sentryHandleError(input as any);
};
