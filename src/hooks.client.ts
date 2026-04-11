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

export const handleError = Sentry.handleErrorWithSentry();
