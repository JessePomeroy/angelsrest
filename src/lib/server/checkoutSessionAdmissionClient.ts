import { createHash, createHmac } from "node:crypto";
import { env as publicEnv } from "$env/dynamic/public";
import { getCheckoutSnapshotReservationCredential } from "$lib/server/checkoutBridgeConfig";

const BEGIN_PATH = "/commerce/checkout-admissions/begin";
const MARK_CREATING_PATH = "/commerce/checkout-admissions/mark-creating";
const MARK_UNCERTAIN_PATH = "/commerce/checkout-admissions/mark-uncertain";
const BIND_PATH = "/commerce/checkout-admissions/bind";
const RELEASE_PATH = "/commerce/checkout-admissions/release";
const REQUEST_MAX_BYTES = 64 * 1024;
const RESPONSE_MAX_BYTES = 2 * 1024;
const REQUEST_TIMEOUT_MS = 5_000;
const DIGEST = /^[0-9a-f]{64}$/;
const ADMISSION_STATES = new Set([
	"active_prestripe",
	"creating",
	"creation_uncertain",
	"bound",
	"consumed_order",
	"released_definite_no_session",
	"expired_unpaid_provider_verified",
	"paid_without_order_attention",
	"reconciliation_uncertain_attention",
]);
const encoder = new TextEncoder();

export type CheckoutAttemptProofClass = "same_origin_host_proof" | "signed_bridge_body";

export interface CheckoutAdmissionIdentity {
	attempt: string;
	attemptStartedAt: number;
	proofClass: CheckoutAttemptProofClass;
}

export interface CheckoutAdmissionPermit {
	site: string;
	account: string | null;
	admissionId: string;
	handleHash: string;
	requestFingerprint: string;
	activeLeaseTokenHash: string;
	stripeIdempotencyDigest: string;
	stripeIdempotencyKey: string;
	hostGeneration: number;
	admissionGeneration: number;
	state: string;
	requestedStripeExpiresAt?: number;
}

export interface CheckoutSessionAdmissionClient {
	begin(input: {
		tenantId?: string;
		site: string;
		account: string | null;
		identity: CheckoutAdmissionIdentity;
		hostGeneration: number;
		requestFingerprint: string;
	}): Promise<CheckoutAdmissionPermit>;
	markCreating(permit: CheckoutAdmissionPermit): Promise<number>;
	markUncertain(permit: CheckoutAdmissionPermit): Promise<void>;
	bind(input: {
		permit: CheckoutAdmissionPermit;
		session: string;
		stripeExpiresAt: number;
		checkoutSnapshotHandle?: string;
	}): Promise<void>;
	release(permit: CheckoutAdmissionPermit): Promise<void>;
}

export function createCheckoutSessionAdmissionClient({
	baseUrl = publicEnv.PUBLIC_CONVEX_SITE_URL,
	fetcher = fetch,
	credential = getCheckoutSnapshotReservationCredential,
	timeoutMs = REQUEST_TIMEOUT_MS,
}: {
	baseUrl?: string;
	fetcher?: typeof fetch;
	credential?: (site: string) => string;
	timeoutMs?: number;
} = {}): CheckoutSessionAdmissionClient {
	const origin = admissionOrigin(baseUrl);

	async function post(path: string, site: string, body: unknown) {
		const serialized = JSON.stringify(body);
		if (encoder.encode(serialized).byteLength > REQUEST_MAX_BYTES) throw unavailable();
		try {
			const response = await fetcher(`${origin}${path}`, {
				method: "POST",
				headers: {
					Authorization: `Bearer ${credential(site)}`,
					"Content-Type": "application/json",
				},
				body: serialized,
				signal: AbortSignal.timeout(timeoutMs),
			});
			const declaredLength = Number(response.headers.get("Content-Length"));
			if (Number.isFinite(declaredLength) && declaredLength > RESPONSE_MAX_BYTES) {
				throw unavailable();
			}
			const text = await readBoundedResponse(response);
			if (!response.ok) throw unavailable();
			return JSON.parse(text) as unknown;
		} catch {
			throw unavailable();
		}
	}

	return {
		async begin({ tenantId, site, account, identity, hostGeneration, requestFingerprint }) {
			const authority = credential(site);
			const scope = `${site}\0${account ?? "platform"}\0${identity.attempt}\0${identity.attemptStartedAt}\0${identity.proofClass}`;
			const attemptDigest = sha256(`checkout-attempt-v1\0${scope}`);
			const handleHash = keyedDigest(authority, `checkout-admission-handle-v1\0${scope}`);
			const activeLeaseTokenHash = keyedDigest(authority, `checkout-admission-lease-v1\0${scope}`);
			const stripeIdempotencyDigest = keyedDigest(
				authority,
				`checkout-admission-stripe-v1\0${scope}`,
			);
			const response = await post(BEGIN_PATH, site, {
				version: 1,
				site,
				...(tenantId ? { tenantId } : {}),
				account,
				attemptDigest,
				proofClass: identity.proofClass,
				admissionHandleHash: handleHash,
				requestFingerprint,
				activeLeaseTokenHash,
				hostGeneration,
			});
			if (!isBeginResponse(response)) throw unavailable();
			return {
				site,
				account,
				admissionId: response.admissionId,
				handleHash,
				requestFingerprint,
				activeLeaseTokenHash,
				stripeIdempotencyDigest,
				stripeIdempotencyKey: `checkout-admission-v1:${stripeIdempotencyDigest}`,
				hostGeneration,
				admissionGeneration: response.admissionGeneration,
				state: response.state,
				...(response.requestedStripeExpiresAt === undefined
					? {}
					: { requestedStripeExpiresAt: response.requestedStripeExpiresAt }),
			};
		},
		async markCreating(permit) {
			const response = await post(MARK_CREATING_PATH, permit.site, {
				version: 1,
				site: permit.site,
				admissionId: permit.admissionId,
				activeLeaseTokenHash: permit.activeLeaseTokenHash,
				requestFingerprint: permit.requestFingerprint,
				stripeIdempotencyDigest: permit.stripeIdempotencyDigest,
			});
			if (!isCreatingResponse(response)) throw unavailable();
			return response.requestedStripeExpiresAt;
		},
		async markUncertain(permit) {
			const response = await post(MARK_UNCERTAIN_PATH, permit.site, {
				version: 1,
				site: permit.site,
				admissionId: permit.admissionId,
				requestFingerprint: permit.requestFingerprint,
				stripeIdempotencyDigest: permit.stripeIdempotencyDigest,
			});
			if (!exactObject(response, ["recorded"]) || response.recorded !== true) throw unavailable();
		},
		async bind({ permit, session, stripeExpiresAt, checkoutSnapshotHandle }) {
			const response = await post(BIND_PATH, permit.site, {
				version: 1,
				site: permit.site,
				admissionId: permit.admissionId,
				requestFingerprint: permit.requestFingerprint,
				stripeIdempotencyDigest: permit.stripeIdempotencyDigest,
				session,
				stripeExpiresAt,
				checkoutSnapshotHandle: checkoutSnapshotHandle ?? null,
			});
			if (
				!exactObject(response, ["outcome"]) ||
				(response.outcome !== "bound" && response.outcome !== "replayed")
			)
				throw unavailable();
		},
		async release(permit) {
			const response = await post(RELEASE_PATH, permit.site, {
				version: 1,
				site: permit.site,
				admissionId: permit.admissionId,
				activeLeaseTokenHash: permit.activeLeaseTokenHash,
			});
			if (!exactObject(response, ["released"]) || typeof response.released !== "boolean") {
				throw unavailable();
			}
		},
	};
}

export function checkoutRequestFingerprint(value: unknown) {
	return sha256(JSON.stringify(value));
}

function keyedDigest(key: string, value: string) {
	return createHmac("sha256", key).update(value).digest("hex");
}

function sha256(value: string) {
	return createHash("sha256").update(value).digest("hex");
}

function isBeginResponse(value: unknown): value is {
	admissionId: string;
	admissionGeneration: number;
	state: string;
	requestedStripeExpiresAt?: number;
} {
	if (!value || typeof value !== "object" || Array.isArray(value)) return false;
	const record = value as Record<string, unknown>;
	const keys =
		record.requestedStripeExpiresAt === undefined
			? ["outcome", "admissionId", "state", "admissionGeneration"]
			: ["outcome", "admissionId", "state", "admissionGeneration", "requestedStripeExpiresAt"];
	return (
		exactObject(record, keys) &&
		(record.outcome === "created" || record.outcome === "replayed") &&
		typeof record.admissionId === "string" &&
		record.admissionId.length > 0 &&
		record.admissionId.length <= 128 &&
		Number.isSafeInteger(record.admissionGeneration) &&
		Number(record.admissionGeneration) >= 1 &&
		typeof record.state === "string" &&
		ADMISSION_STATES.has(record.state) &&
		(record.requestedStripeExpiresAt === undefined ||
			(Number.isSafeInteger(record.requestedStripeExpiresAt) &&
				Number(record.requestedStripeExpiresAt) > 0))
	);
}

function isCreatingResponse(value: unknown): value is {
	state: string;
	requestedStripeExpiresAt: number;
} {
	return (
		exactObject(value, ["state", "requestedStripeExpiresAt"]) &&
		(value.state === "creating" ||
			value.state === "creation_uncertain" ||
			value.state === "bound") &&
		Number.isSafeInteger(value.requestedStripeExpiresAt) &&
		Number(value.requestedStripeExpiresAt) > 0
	);
}

function admissionOrigin(value: string | undefined) {
	try {
		const url = new URL(value ?? "");
		if (
			url.protocol !== "https:" ||
			url.username ||
			url.password ||
			url.pathname !== "/" ||
			url.search ||
			url.hash
		)
			throw unavailable();
		return url.origin;
	} catch {
		throw unavailable();
	}
}

async function readBoundedResponse(response: Response) {
	const reader = response.body?.getReader();
	if (!reader) return "";
	const bytes = new Uint8Array(RESPONSE_MAX_BYTES);
	let size = 0;
	while (true) {
		const { done, value } = await reader.read();
		if (done) return new TextDecoder().decode(bytes.subarray(0, size));
		if (size + value.byteLength > RESPONSE_MAX_BYTES) {
			await reader.cancel();
			throw unavailable();
		}
		bytes.set(value, size);
		size += value.byteLength;
	}
}

function exactObject(value: unknown, keys: readonly string[]): value is Record<string, unknown> {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

function unavailable() {
	return new Error("Checkout admission is unavailable");
}
