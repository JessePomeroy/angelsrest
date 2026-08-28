import { env } from "$env/dynamic/private";
import { handleConvexLogObservationRequest } from "$lib/server/convexLogObservation";
import type { RequestHandler } from "./$types";

export const POST: RequestHandler = ({ request }) =>
	handleConvexLogObservationRequest(request, {
		hmacSecret: env.CONVEX_LOG_STREAM_HMAC_SECRET,
		sentryOtlpLogsEndpoint: env.SENTRY_OBSERVATION_OTLP_LOGS_ENDPOINT,
		sentryPublicKey: env.SENTRY_OBSERVATION_PUBLIC_KEY,
		environment: env.SENTRY_OBSERVATION_ENVIRONMENT,
	});
