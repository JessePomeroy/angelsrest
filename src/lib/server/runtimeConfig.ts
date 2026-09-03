import { env as privateEnv } from "$env/dynamic/private";
import { env as publicEnv } from "$env/dynamic/public";

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
export const getCmsMediaTenantSecret = () =>
	required(privateEnv.CMS_MEDIA_WORKER_SECRET, "CMS media");
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
	if (!Number.isSafeInteger(storeId) || storeId <= 0) {
		throw new RuntimeConfigurationError("LumaPrints");
	}
	return Object.freeze({
		baseUrl:
			privateEnv.LUMAPRINTS_USE_SANDBOX === "true"
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
