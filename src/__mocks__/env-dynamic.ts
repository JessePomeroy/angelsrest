export const env = {
	NOTIFICATION_EMAIL: "test@example.com",
	LUMAPRINTS_API_KEY: "test-key",
	LUMAPRINTS_API_SECRET: "test-secret",
	LUMAPRINTS_STORE_ID: "83765",
	// Explicitly "false" so tests exercise the same production URL path
	// that runtime hits. Flip to "true" if a test specifically needs to
	// verify sandbox routing.
	LUMAPRINTS_USE_SANDBOX: "false",
	STRIPE_WEBHOOK_SECRET: "whsec_mock",
	STRIPE_CONNECT_WEBHOOK_SECRET: "",
	GALLERY_ADMIN_SECRET: "test-secret",
	BETTER_AUTH_SECRET: "test-secret",
	WEBHOOK_SECRET: "test-webhook-secret",
	ORDER_LOOKUP_SECRET: "test-order-lookup-secret",
	CONVEX_LOG_STREAM_HMAC_SECRET: "test-convex-log-stream-hmac-secret",
	SENTRY_OBSERVATION_OTLP_LOGS_ENDPOINT:
		"https://o123.ingest.sentry.io/api/456/integration/otlp/v1/logs",
	SENTRY_OBSERVATION_PUBLIC_KEY: "0123456789abcdef0123456789abcdef",
	SENTRY_OBSERVATION_ENVIRONMENT: "canary",
	ORDER_PRODUCERS_STATE: "open",
	NEW_ORDER_CHECKOUT_CONTROL:
		'{"version":1,"tenants":[{"siteUrl":"angelsrest.online","state":"open","generation":1},{"siteUrl":"zippymiggy.com","state":"open","generation":1}]}',
};
