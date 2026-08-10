import {
	isBoundedStripeExpiration,
	isStripeCheckoutSessionId,
	isStripeConnectedAccountId,
} from "./checkoutSnapshot";
import { isCommerceTenant } from "./commercePurposeControl";

const HEX_DIGEST = /^[0-9a-f]{64}$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return value !== null
		&& typeof value === "object"
		&& !Array.isArray(value)
		&& Object.keys(value).length === keys.length
		&& keys.every((key) => Object.hasOwn(value, key));
}

function digest(value: unknown): value is string {
	return typeof value === "string" && HEX_DIGEST.test(value);
}

function internalId(value: unknown): value is string {
	return typeof value === "string" && value.length >= 8 && value.length <= 128
		&& value === value.trim();
}

function account(value: unknown) {
	return value === null || isStripeConnectedAccountId(value) ? value : undefined;
}

export function parseAdmissionBeginRequest(value: unknown) {
	if (!exactObject(value, [
		"version", "site", "account", "attemptDigest", "proofClass", "admissionHandleHash",
		"requestFingerprint", "activeLeaseTokenHash", "hostGeneration",
	])) return null;
	const connectedAccount = account(value.account);
	return value.version === 1
		&& isCommerceTenant(value.site)
		&& connectedAccount !== undefined
		&& digest(value.attemptDigest)
		&& (value.proofClass === "same_origin_host_proof" || value.proofClass === "signed_bridge_body")
		&& digest(value.admissionHandleHash)
		&& digest(value.requestFingerprint)
		&& digest(value.activeLeaseTokenHash)
		&& Number.isSafeInteger(value.hostGeneration)
		&& Number(value.hostGeneration) >= 1
		? {
				site: value.site,
				account: connectedAccount,
				attemptDigest: value.attemptDigest,
				proofClass: value.proofClass as "same_origin_host_proof" | "signed_bridge_body",
				admissionHandleHash: value.admissionHandleHash,
				requestFingerprint: value.requestFingerprint,
				activeLeaseTokenHash: value.activeLeaseTokenHash,
				hostGeneration: Number(value.hostGeneration),
			}
		: null;
}

export function parseAdmissionMarkCreatingRequest(value: unknown) {
	if (!exactObject(value, [
		"version", "site", "admissionId", "activeLeaseTokenHash", "requestFingerprint",
		"stripeIdempotencyDigest",
	])) return null;
	return value.version === 1 && isCommerceTenant(value.site) && internalId(value.admissionId)
		&& digest(value.activeLeaseTokenHash) && digest(value.requestFingerprint)
		&& digest(value.stripeIdempotencyDigest)
		? {
				site: value.site,
				admissionId: value.admissionId,
				activeLeaseTokenHash: value.activeLeaseTokenHash,
				requestFingerprint: value.requestFingerprint,
				stripeIdempotencyDigest: value.stripeIdempotencyDigest,
			}
		: null;
}

export function parseAdmissionUncertainRequest(value: unknown) {
	if (!exactObject(value, [
		"version", "site", "admissionId", "requestFingerprint", "stripeIdempotencyDigest",
	])) return null;
	return value.version === 1 && isCommerceTenant(value.site) && internalId(value.admissionId)
		&& digest(value.requestFingerprint) && digest(value.stripeIdempotencyDigest)
		? {
				site: value.site,
				admissionId: value.admissionId,
				requestFingerprint: value.requestFingerprint,
				stripeIdempotencyDigest: value.stripeIdempotencyDigest,
			}
		: null;
}

export function parseAdmissionBindRequest(value: unknown) {
	if (!exactObject(value, [
		"version", "site", "admissionId", "requestFingerprint", "stripeIdempotencyDigest",
		"session", "stripeExpiresAt", "checkoutSnapshotHandle",
	])) return null;
	const checkoutSnapshotHandle = value.checkoutSnapshotHandle === null
		? null
		: UUID_V4.test(String(value.checkoutSnapshotHandle))
			? String(value.checkoutSnapshotHandle)
			: undefined;
	return value.version === 1 && isCommerceTenant(value.site) && internalId(value.admissionId)
		&& digest(value.requestFingerprint) && digest(value.stripeIdempotencyDigest)
		&& isStripeCheckoutSessionId(value.session)
		&& isBoundedStripeExpiration(value.stripeExpiresAt)
		&& checkoutSnapshotHandle !== undefined
		? {
				site: value.site,
				admissionId: value.admissionId,
				requestFingerprint: value.requestFingerprint,
				stripeIdempotencyDigest: value.stripeIdempotencyDigest,
				session: value.session,
				stripeExpiresAt: Number(value.stripeExpiresAt),
				checkoutSnapshotHandle,
			}
		: null;
}

export function parseAdmissionReleaseRequest(value: unknown) {
	if (!exactObject(value, ["version", "site", "admissionId", "activeLeaseTokenHash"])) {
		return null;
	}
	return value.version === 1 && isCommerceTenant(value.site) && internalId(value.admissionId)
		&& digest(value.activeLeaseTokenHash)
		? {
				site: value.site,
				admissionId: value.admissionId,
				activeLeaseTokenHash: value.activeLeaseTokenHash,
			}
		: null;
}

export function parsePurposeActivationRequest(value: unknown) {
	if (!exactObject(value, [
		"version", "site", "purpose", "state", "generation", "acceptedHostGeneration",
	])) return null;
	const acceptedHostGeneration = value.acceptedHostGeneration === null
		? null
		: Number.isSafeInteger(value.acceptedHostGeneration) && Number(value.acceptedHostGeneration) >= 1
			? Number(value.acceptedHostGeneration)
			: undefined;
	return value.version === 1 && isCommerceTenant(value.site)
		&& (value.purpose === "new_order_admission" || value.purpose === "new_provider_submission")
		&& (value.state === "open" || value.state === "closed")
		&& Number.isSafeInteger(value.generation) && Number(value.generation) >= 1
		&& acceptedHostGeneration !== undefined
		? {
				site: value.site,
				purpose: value.purpose as "new_order_admission" | "new_provider_submission",
				state: value.state as "open" | "closed",
				generation: Number(value.generation),
				acceptedHostGeneration,
			}
		: null;
}

export function parseCutoffRequest(value: unknown) {
	if (!exactObject(value, ["version", "site", "account", "activationGeneration"])) {
		return null;
	}
	const connectedAccount = account(value.account);
	return value.version === 1 && isCommerceTenant(value.site)
		&& connectedAccount !== undefined
		&& Number.isSafeInteger(value.activationGeneration)
		&& Number(value.activationGeneration) >= 1
		? {
				site: value.site,
				account: connectedAccount,
				activationGeneration: Number(value.activationGeneration),
			}
		: null;
}
