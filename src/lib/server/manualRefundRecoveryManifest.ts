export const MANUAL_REFUND_RECOVERY_ID = "angelsrest-refund-event-selection-gap-v1";

export const manualRefundRecoveryManifest = {
	recoveryId: MANUAL_REFUND_RECOVERY_ID,
	manifestVersion: 1,
	expectedOrigin: "https://www.angelsrest.online",
	expectedConvexUrl: "https://loyal-swan-967.convex.cloud",
	siteUrl: "angelsrest.online",
	stripeContext: "acct_1SzVXnEdZA9bU4XS",
	stripeEventId: "evt_3TzgMtEdZA9bU4XS1UakYelP",
	stripeEventType: "refund.updated",
	stripeEventApiVersion: "2026-01-28.clover",
	stripeRefundId: "re_3TzgMtEdZA9bU4XS18G1xdUE",
	stripeChargeId: "ch_3TzgMtEdZA9bU4XS16dVR60J",
	stripePaymentIntentId: "pi_3TzgMtEdZA9bU4XS1mivC9KA",
	stripeSessionId: "cs_live_a1F5xkFjDxDIQ3Qjikpdo3Oo4OEwwM2jfpiAP589tBByIWZ5iDBLIBzlL0",
	stripeTenantMetadataSiteUrl: "angelsrest.online",
	amount: 1500,
	currency: "usd",
	livemode: true,
	recoveryAuditMetadataKey: "angelsrest_refund_recovery_audit_v1",
} as const;
