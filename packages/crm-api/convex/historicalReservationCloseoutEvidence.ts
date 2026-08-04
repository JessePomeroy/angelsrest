/**
 * Convex-only identity and integrity facts for the reviewed historical row.
 * Do not expose these values to the browser or copy reservation content here.
 */
export const historicalReservationCloseoutEvidence = Object.freeze({
	reservationId: "rn7esxmp3v08tw3sbyn5kp0mdh8bn8vp",
	snapshotDigest: "46e7b8570a339eb775e894ef62b6e5e142b2f44fae793cbf51b659ebbba2052c",
	canonicalSnapshotDigest: "b9a26953efdfd315b7abfe85eb93408d33871398b0d4d928962fa4146b4b620a",
	createdAt: 1_785_603_876_635,
	updatedAt: 1_785_603_877_047,
	boundAt: 1_785_603_877_047,
	stripeExpiresAt: 1_785_689_976,
	unboundPurgeAt: 1_785_693_876_635,
	boundReconcileAt: 1_788_713_976_000,
	// Eight hours before the generic provider-reconciliation action can start.
	closeoutDeadline: 1_788_685_176_000,
});
