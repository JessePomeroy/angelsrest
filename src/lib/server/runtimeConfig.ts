import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";
import { normalizeCommerceTenantSiteUrl } from "$lib/server/stripeConnect";

const MAX_TENANT_REGISTRY_BYTES = 64 * 1024;
const MAX_TENANTS = 100;
const MAX_SECRETS_PER_TENANT = 2;

export class RuntimeConfigurationError extends Error {
	constructor(readonly integration: string) {
		super(`${integration} is not configured`);
		this.name = "RuntimeConfigurationError";
	}
}

function required(value: string | undefined, integration: string): string {
	if (!value?.trim()) throw new RuntimeConfigurationError(integration);
	return value;
}

function origin(value: string | undefined, integration: string): string {
	const configured = required(value, integration);
	try {
		const parsed = new URL(configured);
		if (
			(parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
			parsed.username ||
			parsed.password ||
			parsed.origin !== configured.replace(/\/+$/, "")
		)
			throw new Error();
		return parsed.origin;
	} catch {
		throw new RuntimeConfigurationError(integration);
	}
}

export const getPublicSiteOrigin = () => origin(publicEnv.PUBLIC_SITE_URL, "Public site origin");
export const getConvexUrl = () => origin(publicEnv.PUBLIC_CONVEX_URL, "Convex");
export const getStripeSecretKey = () => required(privateEnv.STRIPE_SECRET_KEY, "Stripe");
export const getStripePlatformWebhookSecret = () =>
	required(privateEnv.STRIPE_PLATFORM_WEBHOOK_SECRET, "Stripe platform webhook");
export const getResendApiKey = () => required(privateEnv.RESEND_API_KEY, "Resend");
export const getGalleryAdminSecret = () =>
	required(privateEnv.GALLERY_ADMIN_SECRET, "Gallery administration");
export function getCmsMediaTenantSecret(siteUrl?: string) {
	const role = tenantCredentialRole(
		privateEnv.CMS_MEDIA_WORKER_SECRET,
		privateEnv.CMS_MEDIA_WORKER_TENANT_SECRETS,
		"CMS media",
	);
	if (!siteUrl) return role.scalar;
	const tenant = normalizeCommerceTenantSiteUrl(siteUrl);
	return required(
		tenant === normalizeCommerceTenantSiteUrl(getPublicSiteOrigin())
			? role.scalar
			: role.registry[tenant]?.[0],
		"CMS media",
	);
}
export function getCatalogPrintSourceIssuerSecret(siteUrl?: string) {
	const upload = tenantCredentialRole(
		privateEnv.CMS_MEDIA_WORKER_SECRET,
		privateEnv.CMS_MEDIA_WORKER_TENANT_SECRETS,
		"CMS media",
	);
	const issuer = tenantCredentialRole(
		privateEnv.CATALOG_PRINT_SOURCE_ISSUER_SECRET,
		privateEnv.CATALOG_PRINT_SOURCE_ISSUER_TENANT_SECRETS,
		"Print source issuer",
	);
	if (issuer.all.some((secret) => upload.all.includes(secret))) {
		throw new RuntimeConfigurationError("Print source issuer");
	}
	if (!siteUrl) return issuer.scalar;
	const tenant = normalizeCommerceTenantSiteUrl(siteUrl);
	return required(
		tenant === normalizeCommerceTenantSiteUrl(getPublicSiteOrigin())
			? issuer.scalar
			: issuer.registry[tenant]?.[0],
		"Print source issuer",
	);
}
export const getCmsMediaConvexSiteOrigin = () =>
	origin(publicEnv.PUBLIC_CONVEX_SITE_URL, "CMS media deletion completion");
export const getCmsMediaDeletionCompletionSecret = () =>
	required(privateEnv.CMS_MEDIA_DELETION_COMPLETION_SECRET, "CMS media deletion completion");

export function getCatalogPrivateEditorUploadConfig() {
	const hostJournalSecret = privateEnv.CATALOG_PRIVATE_EDITOR_UPLOAD_HOST_JOURNAL_SECRET;
	const storageCallerSecret = privateEnv.CATALOG_PRIVATE_EDITOR_UPLOAD_STORAGE_CALLER_SECRET;
	return publicEnv.PUBLIC_CONVEX_URL === "https://loyal-swan-967.convex.cloud" &&
		isBearerCredential(hostJournalSecret) &&
		isBearerCredential(storageCallerSecret) &&
		hostJournalSecret !== storageCallerSecret
		? Object.freeze({
				convexJournalOrigin: "https://loyal-swan-967.convex.site",
				hostJournalSecret,
				workerOrigin: "https://cms-media-worker.thinkingofview.workers.dev" as const,
				storageCallerSecret,
				browserOrigin: "https://www.angelsrest.online",
			})
		: undefined;
}

export function getLumaPrintsRuntimeConfig() {
	const rawStoreId = required(privateEnv.LUMAPRINTS_STORE_ID, "LumaPrints");
	const storeId = /^\d+$/.test(rawStoreId) ? Number(rawStoreId) : Number.NaN;
	const sandbox = privateEnv.LUMAPRINTS_USE_SANDBOX;
	if (
		!Number.isSafeInteger(storeId) ||
		storeId <= 0 ||
		!["true", "false"].includes(sandbox ?? "")
	) {
		throw new RuntimeConfigurationError("LumaPrints");
	}
	return Object.freeze({
		baseUrl:
			sandbox === "true"
				? "https://us.api-sandbox.lumaprints.com"
				: "https://us.api.lumaprints.com",
		apiKey: required(privateEnv.LUMAPRINTS_API_KEY, "LumaPrints"),
		apiSecret: required(privateEnv.LUMAPRINTS_API_SECRET, "LumaPrints"),
		storeId,
	});
}

const TOKEN68_BEARER_PATTERN = /^[-A-Za-z0-9._~+/]+={0,}$/;

function isBearerCredential(value: string | undefined): value is string {
	return Boolean(
		value && value.length >= 32 && value.length <= 512 && TOKEN68_BEARER_PATTERN.test(value),
	);
}

function tenantCredentialRole(
	scalar: string | undefined,
	rawRegistry: string | undefined,
	integration: string,
) {
	const configuredScalar = required(scalar, integration);
	const registry = parseTenantSecrets(rawRegistry, integration);
	const all = [configuredScalar, ...Object.values(registry).flat()];
	if (new Set(all).size !== all.length) throw new RuntimeConfigurationError(integration);
	return { scalar: configuredScalar, registry, all };
}

function parseTenantSecrets(raw: string | undefined, integration: string) {
	if (!raw) return Object.create(null) as Record<string, string[]>;
	if (Buffer.byteLength(raw, "utf8") > MAX_TENANT_REGISTRY_BYTES) {
		throw new RuntimeConfigurationError(integration);
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		throw new RuntimeConfigurationError(integration);
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
		throw new RuntimeConfigurationError(integration);
	}
	const entries = Object.entries(parsed);
	if (entries.length < 1 || entries.length > MAX_TENANTS) {
		throw new RuntimeConfigurationError(integration);
	}
	const registry = Object.create(null) as Record<string, string[]>;
	const seen = new Set<string>();
	for (const [siteUrl, value] of entries) {
		if (
			siteUrl !== normalizeCommerceTenantSiteUrl(siteUrl) ||
			!Array.isArray(value) ||
			value.length < 1 ||
			value.length > MAX_SECRETS_PER_TENANT ||
			new Set(value).size !== value.length ||
			value.some((secret) => !isBearerCredential(secret) || seen.has(secret))
		) {
			throw new RuntimeConfigurationError(integration);
		}
		for (const secret of value) seen.add(secret);
		registry[siteUrl] = value;
	}
	return registry;
}
