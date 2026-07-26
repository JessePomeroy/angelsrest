import { createHash } from "node:crypto";
import { env } from "$env/dynamic/private";

const MAX_REGISTRY_BYTES = 64 * 1024;
const MAX_TENANTS = 100;
const MAX_SECRETS_PER_TENANT = 2;
const MAX_REDIRECT_ORIGINS_PER_TENANT = 10;
const MIN_SECRET_LENGTH = 32;
const MAX_SECRET_LENGTH = 512;
const CREDENTIAL_FINGERPRINT = /^[0-9a-f]{64}$/;
const CHECKOUT_ROLE_NAMES = ["checkoutBridge", "checkoutSnapshotReservation"] as const;

interface CheckoutRoleCredentialFingerprints {
	checkoutBridge: readonly string[];
	checkoutSnapshotReservation: readonly string[];
}

export interface CheckoutBridgeTenantConfig {
	secrets: string[];
	redirectOrigins: string[];
}

type CheckoutBridgeTenantRegistry = Record<string, CheckoutBridgeTenantConfig>;
type CheckoutSnapshotReservationRegistry = Record<string, readonly string[]>;

export function getCheckoutSnapshotReservationCredential(
	siteUrl: string,
	rawRegistry = env.CHECKOUT_SNAPSHOT_RESERVATION_SECRETS,
	rawFingerprints = env.CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS,
): string {
	const registry = parseCheckoutSnapshotReservationRegistry(rawRegistry);
	if (!rawFingerprints) throw new Error("Checkout reservation credentials are unavailable");
	const manifest = parseCheckoutRoleCredentialFingerprints(rawFingerprints);
	const localFingerprints = Object.values(registry).flat().map(checkoutCredentialFingerprint);
	if (
		localFingerprints.length !== manifest.checkoutSnapshotReservation.length ||
		localFingerprints.some(
			(fingerprint) => !manifest.checkoutSnapshotReservation.includes(fingerprint),
		)
	)
		throw new Error("Checkout reservation credentials are unavailable");
	const current = registry[siteUrl]?.[0];
	if (!current) throw new Error("Checkout reservation credentials are unavailable");
	return current;
}

export function getCheckoutBridgeTenantConfig(
	siteUrl: string,
	rawRegistry = env.CHECKOUT_BRIDGE_TENANTS,
	rawFingerprints = env.CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS,
): CheckoutBridgeTenantConfig | null {
	const registry = parseCheckoutBridgeTenantRegistry(rawRegistry);
	if (rawFingerprints !== undefined) {
		const manifest = parseCheckoutRoleCredentialFingerprints(rawFingerprints);
		const localFingerprints = Object.values(registry)
			.flatMap(({ secrets }) => secrets)
			.map(checkoutCredentialFingerprint);
		if (
			localFingerprints.length !== manifest.checkoutBridge.length ||
			localFingerprints.some((fingerprint) => !manifest.checkoutBridge.includes(fingerprint))
		)
			throw new Error("Checkout role credential fingerprints do not match configuration");
	}
	const tenant = registry[siteUrl];
	if (!tenant) return null;
	return { secrets: [...tenant.secrets], redirectOrigins: [...tenant.redirectOrigins] };
}

export function parseCheckoutRoleCredentialFingerprints(
	raw: string,
): CheckoutRoleCredentialFingerprints {
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new Error("CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS contains invalid JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS must be an object");
	}
	const record = parsed as Record<string, unknown>;
	if (
		Object.keys(record).length !== CHECKOUT_ROLE_NAMES.length ||
		!CHECKOUT_ROLE_NAMES.every((role) => Object.hasOwn(record, role))
	)
		throw new Error("CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS has invalid roles");
	const checkoutBridge = parseCredentialFingerprintList(record.checkoutBridge);
	const checkoutSnapshotReservation = parseCredentialFingerprintList(
		record.checkoutSnapshotReservation,
	);
	if (checkoutBridge.some((fingerprint) => checkoutSnapshotReservation.includes(fingerprint))) {
		throw new Error("Checkout role credentials overlap");
	}
	return { checkoutBridge, checkoutSnapshotReservation };
}

export function checkoutCredentialFingerprint(secret: string) {
	return createHash("sha256").update(secret).digest("hex");
}

export function parseCheckoutSnapshotReservationRegistry(rawRegistry: string | undefined) {
	if (!rawRegistry || Buffer.byteLength(rawRegistry, "utf8") > MAX_REGISTRY_BYTES) {
		throw new Error("Checkout reservation credentials are unavailable");
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(rawRegistry);
	} catch {
		throw new Error("Checkout reservation credentials are unavailable");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("Checkout reservation credentials are unavailable");
	}
	const entries = Object.entries(parsed);
	if (entries.length === 0 || entries.length > MAX_TENANTS) {
		throw new Error("Checkout reservation credentials are unavailable");
	}
	const registry = Object.create(null) as CheckoutSnapshotReservationRegistry;
	const seen = new Set<string>();
	for (const [siteUrl, value] of entries) {
		if (!siteUrl || siteUrl !== siteUrl.trim() || siteUrl.length > 253 || !Array.isArray(value)) {
			throw new Error("Checkout reservation credentials are unavailable");
		}
		const secrets = value as unknown[];
		if (
			secrets.length === 0 ||
			secrets.length > MAX_SECRETS_PER_TENANT ||
			secrets.some(
				(secret) =>
					typeof secret !== "string" ||
					secret !== secret.trim() ||
					secret.length < MIN_SECRET_LENGTH ||
					secret.length > MAX_SECRET_LENGTH ||
					seen.has(secret),
			)
		)
			throw new Error("Checkout reservation credentials are unavailable");
		for (const secret of secrets as string[]) seen.add(secret);
		registry[siteUrl] = secrets as string[];
	}
	return registry;
}

export function parseCheckoutBridgeTenantRegistry(rawRegistry: string | undefined) {
	if (!rawRegistry) throw new Error("CHECKOUT_BRIDGE_TENANTS is not configured");
	if (Buffer.byteLength(rawRegistry, "utf8") > MAX_REGISTRY_BYTES) {
		throw new Error("CHECKOUT_BRIDGE_TENANTS is too large");
	}

	let parsed: unknown;
	try {
		parsed = JSON.parse(rawRegistry);
	} catch {
		throw new Error("CHECKOUT_BRIDGE_TENANTS contains invalid JSON");
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new Error("CHECKOUT_BRIDGE_TENANTS must be an object");
	}

	const entries = Object.entries(parsed);
	if (entries.length === 0 || entries.length > MAX_TENANTS) {
		throw new Error("CHECKOUT_BRIDGE_TENANTS has an invalid tenant count");
	}

	const registry = Object.create(null) as CheckoutBridgeTenantRegistry;
	for (const [siteUrl, value] of entries) {
		if (!siteUrl || siteUrl !== siteUrl.trim() || siteUrl.length > 253) {
			throw new Error("CHECKOUT_BRIDGE_TENANTS contains an invalid tenant key");
		}
		if (!value || typeof value !== "object" || Array.isArray(value)) {
			throw new Error(`Invalid checkout bridge configuration for ${siteUrl}`);
		}
		const record = value as Record<string, unknown>;
		registry[siteUrl] = {
			secrets: parseSecrets(record.secrets, siteUrl),
			redirectOrigins: parseRedirectOrigins(record.redirectOrigins, siteUrl),
		};
	}
	return registry;
}

function parseCredentialFingerprintList(value: unknown) {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > MAX_TENANTS * MAX_SECRETS_PER_TENANT ||
		value.some(
			(fingerprint) => typeof fingerprint !== "string" || !CREDENTIAL_FINGERPRINT.test(fingerprint),
		) ||
		new Set(value).size !== value.length
	)
		throw new Error("CHECKOUT_ROLE_CREDENTIAL_FINGERPRINTS has an invalid fingerprint list");
	return value as string[];
}

function parseSecrets(value: unknown, siteUrl: string) {
	if (!Array.isArray(value) || value.length === 0 || value.length > MAX_SECRETS_PER_TENANT) {
		throw new Error(`Invalid checkout bridge secrets for ${siteUrl}`);
	}
	const secrets = value.map((secret) => {
		if (
			typeof secret !== "string" ||
			secret.length < MIN_SECRET_LENGTH ||
			secret.length > MAX_SECRET_LENGTH
		) {
			throw new Error(`Invalid checkout bridge secret for ${siteUrl}`);
		}
		return secret;
	});
	if (new Set(secrets).size !== secrets.length) {
		throw new Error(`Duplicate checkout bridge secret for ${siteUrl}`);
	}
	return secrets;
}

function parseRedirectOrigins(value: unknown, siteUrl: string) {
	if (
		!Array.isArray(value) ||
		value.length === 0 ||
		value.length > MAX_REDIRECT_ORIGINS_PER_TENANT
	) {
		throw new Error(`Invalid checkout redirect origins for ${siteUrl}`);
	}
	const origins = value.map((origin) => normalizeRedirectOrigin(origin, siteUrl));
	if (new Set(origins).size !== origins.length) {
		throw new Error(`Duplicate checkout redirect origin for ${siteUrl}`);
	}
	return origins;
}

function normalizeRedirectOrigin(value: unknown, siteUrl: string) {
	if (typeof value !== "string" || !value) {
		throw new Error(`Invalid checkout redirect origin for ${siteUrl}`);
	}
	let url: URL;
	try {
		url = new URL(value);
	} catch {
		throw new Error(`Invalid checkout redirect origin for ${siteUrl}`);
	}
	if (url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
		throw new Error(`Checkout redirect allowlist entries must be origins for ${siteUrl}`);
	}
	const isLocalHttp =
		url.protocol === "http:" && (url.hostname === "localhost" || url.hostname === "127.0.0.1");
	if (url.protocol !== "https:" && !isLocalHttp) {
		throw new Error(`Checkout redirect origin must use HTTPS for ${siteUrl}`);
	}
	return url.origin;
}
