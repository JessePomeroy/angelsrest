export const env = {
	NOTIFICATION_EMAIL: "test@example.com",
	LUMAPRINTS_API_KEY: "test-key",
	LUMAPRINTS_API_SECRET: "test-secret",
	LUMAPRINTS_STORE_ID: "83765",
	// Explicitly "false" so tests exercise the same production URL path
	// that runtime hits. Flip to "true" if a test specifically needs to
	// verify sandbox routing.
	LUMAPRINTS_USE_SANDBOX: "false",
	STRIPE_CRM_PRICE_ID: "price_test_xxx",
	GALLERY_ADMIN_SECRET: "test-secret",
	BETTER_AUTH_SECRET: "test-secret",
};
