import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
	type SiteSettingsDraftPayload,
	serializeSiteSettingsPayload,
	siteSettingsDraftPayloadValidator,
	toPublishedSiteSettings,
	validateSiteSettingsDraft,
} from "./contentValidators";
import { checksumContentPayload } from "./contentStore";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const SANITY_IMAGE_REF_PATTERN = /^image-[A-Za-z0-9]+-\d+x\d+-[A-Za-z0-9]+$/;
const WORKER_ASSET_ID_PATTERN =
	/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const SOCIAL_PLATFORMS = new Set([
	"instagram",
	"twitter",
	"facebook",
	"tiktok",
	"youtube",
	"linkedin",
	"threads",
]);

export const SITE_SETTINGS_OG_FALLBACK = "/og-image.png" as const;

const sourceIdentityValidator = v.object({
	projectId: v.string(),
	dataset: v.string(),
	perspective: v.literal("published"),
});

const textDecisionValidator = v.object({
	action: v.union(
		v.literal("use-source-owner-approved"),
		v.literal("owner-replacement"),
	),
	sourceValueCanonical: v.string(),
	value: v.string(),
});

const socialDecisionValidator = v.object({
	action: v.union(
		v.literal("use-source-owner-approved"),
		v.literal("owner-replacement"),
	),
	sourceValueCanonical: v.string(),
	sourceKeyAction: v.literal("omit-sanity-array-keys-owner-approved"),
	value: v.array(v.object({ platform: v.string(), url: v.string() })),
});

const unsupportedDecisionValidator = v.object({
	action: v.union(
		v.literal("confirmed-absent-owner-approved"),
		v.literal("omit-unrendered-owner-approved"),
	),
	sourceValueCanonical: v.string(),
});

const seoImageDecisionValidator = v.union(
	v.object({
		action: v.literal("keep-host-fallback-owner-approved"),
		sourceValueCanonical: v.literal("null"),
		fallbackPath: v.literal(SITE_SETTINGS_OG_FALLBACK),
	}),
	v.object({
		action: v.literal("extend-target-and-transfer-exact-source"),
		sourceAssetRef: v.string(),
		sourceSha256: v.string(),
		sourceWidth: v.number(),
		sourceHeight: v.number(),
		sourceContentType: v.string(),
		sourceCropCanonical: v.string(),
		sourceHotspotCanonical: v.string(),
		targetMediaAssetId: v.id("mediaAssets"),
		targetWorkerAssetId: v.string(),
		targetReceiptSha256: v.string(),
	}),
);

export const sanitySiteSettingsPlanValidator = v.object({
	version: v.literal(1),
	migrationId: v.string(),
	siteUrl: v.string(),
	source: sourceIdentityValidator,
	sourceDocument: v.object({
		sourceId: v.string(),
		sourceRevision: v.string(),
	}),
	decisionSet: v.object({
		id: v.string(),
		artistName: textDecisionValidator,
		siteTitle: textDecisionValidator,
		tagline: textDecisionValidator,
		socialLinks: socialDecisionValidator,
		seoDescription: textDecisionValidator,
		logo: unsupportedDecisionValidator,
		seoKeywords: unsupportedDecisionValidator,
		seoImage: seoImageDecisionValidator,
	}),
	payload: siteSettingsDraftPayloadValidator,
});

export type SanitySiteSettingsPlan = Infer<typeof sanitySiteSettingsPlanValidator>;

export type SanitySiteSettingsSource = {
	siteSettings: readonly unknown[];
};

type TextInputDecision =
	| { action: "use-source-owner-approved" }
	| { action: "owner-replacement"; value: string };

type SocialLink = { platform: string; url: string };

export type SanitySiteSettingsOwnerDecisions = {
	id: string;
	artistName: TextInputDecision;
	siteTitle: TextInputDecision;
	tagline: TextInputDecision;
	socialLinks:
		| { action: "use-source-owner-approved" }
		| { action: "owner-replacement"; value: readonly SocialLink[] };
	seoDescription: TextInputDecision;
	logo:
		| { action: "confirmed-absent-owner-approved" }
		| { action: "omit-unrendered-owner-approved" };
	seoKeywords:
		| { action: "confirmed-absent-owner-approved" }
		| { action: "omit-unrendered-owner-approved" };
	seoImage:
		| { action: "keep-host-fallback-owner-approved" }
		| {
				action: "extend-target-and-transfer-exact-source";
				sourceSha256: string;
				targetMediaAssetId: Id<"mediaAssets">;
				targetWorkerAssetId: string;
				targetReceiptSha256: string;
		  };
};

export type SanitySiteSettingsBuildOptions = {
	migrationId: string;
	siteUrl: string;
	source: SanitySiteSettingsPlan["source"];
	decisions: SanitySiteSettingsOwnerDecisions;
};

type JsonRecord = Record<string, unknown>;

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Plan contains a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.entries(value as JsonRecord)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Plan contains an unsupported value");
}

function asRecord(value: unknown, label: string): JsonRecord {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as JsonRecord;
}

function requireStableId(value: unknown, label: string) {
	if (typeof value !== "string" || !STABLE_ID_PATTERN.test(value)) {
		throw new Error(`${label} is invalid`);
	}
	return value;
}

function requireRevision(value: unknown, label: string) {
	if (typeof value !== "string" || !REVISION_PATTERN.test(value)) {
		throw new Error(`${label} is invalid`);
	}
	return value;
}

function sourceText(value: unknown, label: string) {
	if (value === undefined || value === null || value === "") return null;
	if (typeof value !== "string") throw new Error(`${label} must be text`);
	return value;
}

function requiredBoundedText(value: unknown, label: string, maximum: number) {
	if (typeof value !== "string") throw new Error(`${label} is required`);
	const normalized = value.trim();
	if (!normalized) throw new Error(`${label} is required`);
	if (normalized.length > maximum) {
		throw new Error(`${label} must be ${maximum} characters or fewer`);
	}
	return normalized;
}

function resolveText(
	sourceValue: unknown,
	decision: TextInputDecision,
	label: string,
	maximum: number,
) {
	const source = sourceText(sourceValue, label);
	if (decision.action === "use-source-owner-approved") {
		const value = requiredBoundedText(source, label, maximum);
		if (source !== value) {
			throw new Error(`${label} requires an owner replacement because target normalization differs`);
		}
		return {
			action: decision.action,
			sourceValueCanonical: canonicalJson(source),
			value,
		};
	}
	return {
		action: decision.action,
		sourceValueCanonical: canonicalJson(source),
		value: requiredBoundedText(decision.value, `Replacement ${label}`, maximum),
	};
}

function publicUrl(value: unknown, label: string) {
	const normalized = requiredBoundedText(value, label, 2_048);
	if (value !== normalized) throw new Error(`${label} contains boundary whitespace`);
	let parsed: URL;
	try {
		parsed = new URL(normalized);
	} catch {
		throw new Error(`${label} must be a public HTTP URL`);
	}
	if (
		(parsed.protocol !== "https:" && parsed.protocol !== "http:")
		|| parsed.username
		|| parsed.password
	) throw new Error(`${label} must be a public HTTP URL`);
	return normalized;
}

function socialLinks(value: unknown, label: string): SocialLink[] {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.length > 20) {
		throw new Error(`${label} must contain at most 20 links`);
	}
	const platforms = new Set<string>();
	const urls = new Set<string>();
	return value.map((entry, index) => {
		const link = asRecord(entry, `${label} ${index + 1}`);
		const platform = requiredBoundedText(
			link.platform,
			`${label} ${index + 1} platform`,
			50,
		);
		if (!SOCIAL_PLATFORMS.has(platform) || link.platform !== platform) {
			throw new Error(`${label} ${index + 1} platform is unsupported`);
		}
		const url = publicUrl(link.url, `${label} ${index + 1} URL`);
		if (platforms.has(platform) || urls.has(url)) {
			throw new Error(`${label} must not contain duplicate platforms or URLs`);
		}
		platforms.add(platform);
		urls.add(url);
		return { platform, url };
	});
}

function imageReference(value: unknown, label: string) {
	if (value === undefined || value === null) return null;
	const image = asRecord(value, label);
	const asset = asRecord(image.asset, `${label} asset`);
	if (typeof asset._ref !== "string" || !SANITY_IMAGE_REF_PATTERN.test(asset._ref)) {
		throw new Error(`${label} asset reference is invalid`);
	}
	return asset._ref;
}

export function parseSanitySiteSettingsImageReference(reference: string) {
	const match = reference.match(
		/^image-[A-Za-z0-9]+-(\d+)x(\d+)-(jpg|jpeg|png|webp)$/,
	);
	if (!match) throw new Error("Site Settings SEO image asset reference is invalid");
	const width = Number(match[1]);
	const height = Number(match[2]);
	if (
		!Number.isSafeInteger(width)
		|| width <= 0
		|| !Number.isSafeInteger(height)
		|| height <= 0
	) throw new Error("Site Settings SEO image dimensions are invalid");
	const format = match[3];
	return {
		width,
		height,
		contentType: format === "png"
			? "image/png" as const
			: format === "webp"
				? "image/webp" as const
				: "image/jpeg" as const,
	};
}

function requireSha256(value: string, label: string) {
	if (!SHA256_PATTERN.test(value)) throw new Error(`${label} is invalid`);
	return value;
}

function keywords(value: unknown) {
	if (value === undefined || value === null) return [];
	if (!Array.isArray(value) || value.length > 100) {
		throw new Error("Site Settings SEO keywords must contain at most 100 items");
	}
	return value.map((entry, index) =>
		requiredBoundedText(entry, `Site Settings SEO keyword ${index + 1}`, 500),
	);
}

function unsupportedDecision(
	sourceValue: unknown,
	present: boolean,
	decision:
		| { action: "confirmed-absent-owner-approved" }
		| { action: "omit-unrendered-owner-approved" },
	label: string,
) {
	const requiredAction = present
		? "omit-unrendered-owner-approved"
		: "confirmed-absent-owner-approved";
	if (decision.action !== requiredAction) {
		throw new Error(`${label} decision does not match the source`);
	}
	return {
		action: decision.action,
		sourceValueCanonical: canonicalJson(sourceValue),
	};
}

function canonicalValue(value: string, label: string) {
	let parsed: unknown;
	try {
		parsed = JSON.parse(value);
	} catch {
		throw new Error(`${label} source binding is invalid`);
	}
	if (canonicalJson(parsed) !== value) throw new Error(`${label} source binding is not canonical`);
	return parsed;
}

/** Build one revision-pinned singleton plan without provider access or writes. */
export function createSanitySiteSettingsPlan(
	source: SanitySiteSettingsSource,
	options: SanitySiteSettingsBuildOptions,
): SanitySiteSettingsPlan {
	if (!Array.isArray(source.siteSettings) || source.siteSettings.length !== 1) {
		throw new Error("Exactly one published Site Settings document is required");
	}
	const document = asRecord(source.siteSettings[0], "Site Settings source");
	if (document._type !== "siteSettings") {
		throw new Error("Expected a Sanity siteSettings document");
	}
	const seo = document.seo === undefined || document.seo === null
		? {}
		: asRecord(document.seo, "Site Settings SEO");
	const sourceSocialLinks = socialLinks(document.socialLinks, "Site Settings social links");
	const selectedSocialLinks = options.decisions.socialLinks.action === "use-source-owner-approved"
		? sourceSocialLinks
		: socialLinks(options.decisions.socialLinks.value, "Replacement social links");
	const logoReference = imageReference(document.logo, "Site Settings logo");
	const sourceKeywords = keywords(seo.keywords);
	const seoImageReference = imageReference(seo.ogImage, "Site Settings SEO image");
	const seoImageObject = seoImageReference === null
		? null
		: asRecord(seo.ogImage, "Site Settings SEO image");
	const sourceCropCanonical = canonicalJson(seoImageObject?.crop ?? null);
	const sourceHotspotCanonical = canonicalJson(seoImageObject?.hotspot ?? null);
	if (sourceCropCanonical !== "null" || sourceHotspotCanonical !== "null") {
		throw new Error("Site Settings SEO image crop or hotspot requires explicit target support");
	}
	const seoImageInput = options.decisions.seoImage;
	if (
		(seoImageReference === null
			&& seoImageInput.action !== "keep-host-fallback-owner-approved")
		|| (seoImageReference !== null
			&& seoImageInput.action !== "extend-target-and-transfer-exact-source")
	) throw new Error("Site Settings SEO image decision does not match the source");
	const transferredSeoImage = seoImageInput.action === "extend-target-and-transfer-exact-source"
		? seoImageInput
		: null;
	const seoImageSource = seoImageReference === null
		? null
		: parseSanitySiteSettingsImageReference(seoImageReference);
	const seoImage = seoImageReference === null
		? {
				action: "keep-host-fallback-owner-approved" as const,
				sourceValueCanonical: "null" as const,
				fallbackPath: SITE_SETTINGS_OG_FALLBACK,
			}
		: {
				action: "extend-target-and-transfer-exact-source" as const,
				sourceAssetRef: seoImageReference,
				sourceSha256: requireSha256(
					transferredSeoImage?.sourceSha256 ?? "",
					"Site Settings SEO image source SHA-256",
				),
				sourceWidth: seoImageSource?.width ?? 0,
				sourceHeight: seoImageSource?.height ?? 0,
				sourceContentType: seoImageSource?.contentType ?? "",
				sourceCropCanonical,
				sourceHotspotCanonical,
				targetMediaAssetId: transferredSeoImage?.targetMediaAssetId as Id<"mediaAssets">,
				targetWorkerAssetId: requiredBoundedText(
					transferredSeoImage?.targetWorkerAssetId,
					"Site Settings SEO image worker asset ID",
					36,
				),
				targetReceiptSha256: requireSha256(
					transferredSeoImage?.targetReceiptSha256 ?? "",
					"Site Settings SEO image receipt digest",
				),
			};
	if (
		seoImage.action === "extend-target-and-transfer-exact-source"
		&& !WORKER_ASSET_ID_PATTERN.test(seoImage.targetWorkerAssetId)
	) throw new Error("Site Settings SEO image worker asset ID is invalid");

	const artistName = resolveText(
		document.artistName,
		options.decisions.artistName,
		"Site Settings artist name",
		120,
	);
	const siteTitle = resolveText(
		document.siteTitle,
		options.decisions.siteTitle,
		"Site Settings site title",
		120,
	);
	const tagline = resolveText(
		document.tagline,
		options.decisions.tagline,
		"Site Settings tagline",
		300,
	);
	const seoDescription = resolveText(
		seo.description,
		options.decisions.seoDescription,
		"Site Settings SEO description",
		320,
	);
	const payload: SiteSettingsDraftPayload = {
		artistName: artistName.value,
		siteTitle: siteTitle.value,
		tagline: tagline.value,
		socialLinks: selectedSocialLinks,
		seoDescription: seoDescription.value,
		...(seoImage.action === "extend-target-and-transfer-exact-source"
			? { seoOgImageAssetId: seoImage.targetMediaAssetId }
			: {}),
	};

	const plan: SanitySiteSettingsPlan = {
		version: 1,
		migrationId: options.migrationId,
		siteUrl: options.siteUrl,
		source: options.source,
		sourceDocument: {
			sourceId: requireStableId(document._id, "Site Settings source ID"),
			sourceRevision: requireRevision(document._rev, "Site Settings source revision"),
		},
		decisionSet: {
			id: options.decisions.id,
			artistName,
			siteTitle,
			tagline,
			socialLinks: {
				action: options.decisions.socialLinks.action,
				sourceValueCanonical: canonicalJson(document.socialLinks ?? null),
				sourceKeyAction: "omit-sanity-array-keys-owner-approved",
				value: selectedSocialLinks,
			},
			seoDescription,
			logo: unsupportedDecision(
				logoReference,
				logoReference !== null,
				options.decisions.logo,
				"Site Settings logo",
			),
			seoKeywords: unsupportedDecision(
				seo.keywords ?? null,
				sourceKeywords.length > 0,
				options.decisions.seoKeywords,
				"Site Settings SEO keywords",
			),
			seoImage,
		},
		payload,
	};
	assertSanitySiteSettingsPlan(plan);
	return plan;
}

/** Runtime semantic validation; called before hashing and every mutation. */
export function assertSanitySiteSettingsPlan(plan: SanitySiteSettingsPlan) {
	if (plan.version !== 1 || plan.source.perspective !== "published") {
		throw new Error("Site Settings source identity is invalid");
	}
	for (const [value, label] of [
		[plan.migrationId, "Migration ID"],
		[plan.siteUrl, "Site URL"],
		[plan.source.projectId, "Sanity project ID"],
		[plan.source.dataset, "Sanity dataset"],
		[plan.decisionSet.id, "Decision set ID"],
	] as const) requireStableId(value, label);
	requireStableId(plan.sourceDocument.sourceId, "Site Settings source ID");
	requireRevision(plan.sourceDocument.sourceRevision, "Site Settings source revision");

	for (const [decision, payloadValue, label] of [
		[plan.decisionSet.artistName, plan.payload.artistName, "artist name"],
		[plan.decisionSet.siteTitle, plan.payload.siteTitle, "site title"],
		[plan.decisionSet.tagline, plan.payload.tagline, "tagline"],
		[plan.decisionSet.seoDescription, plan.payload.seoDescription, "SEO description"],
	] as const) {
		canonicalValue(decision.sourceValueCanonical, `Site Settings ${label}`);
		if (
			decision.value !== payloadValue
			|| (decision.action === "use-source-owner-approved"
				&& decision.sourceValueCanonical !== canonicalJson(decision.value))
		) throw new Error(`Site Settings ${label} decision binding is invalid`);
	}

	canonicalValue(
		plan.decisionSet.socialLinks.sourceValueCanonical,
		"Site Settings social links",
	);
	if (
		plan.decisionSet.socialLinks.sourceKeyAction
			!== "omit-sanity-array-keys-owner-approved"
		|| canonicalJson(plan.decisionSet.socialLinks.value)
			!== canonicalJson(plan.payload.socialLinks ?? [])
	) throw new Error("Site Settings social-link decision binding is invalid");
	socialLinks(plan.decisionSet.socialLinks.value, "Site Settings social links");

	for (const [decision, label] of [
		[plan.decisionSet.logo, "logo"],
		[plan.decisionSet.seoKeywords, "SEO keywords"],
	] as const) {
		const sourceValue = canonicalValue(
			decision.sourceValueCanonical,
			`Site Settings ${label}`,
		);
		const absent = sourceValue === null || (Array.isArray(sourceValue) && sourceValue.length === 0);
		if (
			(absent && decision.action !== "confirmed-absent-owner-approved")
			|| (!absent && decision.action !== "omit-unrendered-owner-approved")
		) throw new Error(`Site Settings ${label} decision binding is invalid`);
	}
	const seoImage = plan.decisionSet.seoImage;
	if (seoImage.action === "keep-host-fallback-owner-approved") {
		if (
			seoImage.sourceValueCanonical !== "null"
			|| seoImage.fallbackPath !== SITE_SETTINGS_OG_FALLBACK
			|| plan.payload.seoOgImageAssetId !== undefined
		) throw new Error("Site Settings SEO image decision binding is invalid");
	} else {
		const source = parseSanitySiteSettingsImageReference(seoImage.sourceAssetRef);
		if (
			!SANITY_IMAGE_REF_PATTERN.test(seoImage.sourceAssetRef)
			|| source.width !== seoImage.sourceWidth
			|| source.height !== seoImage.sourceHeight
			|| source.contentType !== seoImage.sourceContentType
			|| seoImage.sourceCropCanonical !== "null"
			|| seoImage.sourceHotspotCanonical !== "null"
			|| !SHA256_PATTERN.test(seoImage.sourceSha256)
			|| !SHA256_PATTERN.test(seoImage.targetReceiptSha256)
			|| !WORKER_ASSET_ID_PATTERN.test(seoImage.targetWorkerAssetId)
			|| plan.payload.seoOgImageAssetId !== seoImage.targetMediaAssetId
		) throw new Error("Site Settings SEO image decision binding is invalid");
	}

	validateSiteSettingsDraft(plan.payload);
	toPublishedSiteSettings(plan.payload);
	serializeSiteSettingsPayload(plan.payload);
}

export async function digestSanitySiteSettingsPlan(plan: SanitySiteSettingsPlan) {
	assertSanitySiteSettingsPlan(plan);
	return await checksumContentPayload(canonicalJson(plan));
}

export async function requireSanitySiteSettingsPlan(
	plan: SanitySiteSettingsPlan,
	expectedDigest: string,
) {
	if (!SHA256_PATTERN.test(expectedDigest)) {
		throw new Error("Site Settings plan digest is invalid");
	}
	const digest = await digestSanitySiteSettingsPlan(plan);
	if (digest !== expectedDigest) {
		throw new Error("Site Settings plan digest does not match canonical bytes");
	}
	return digest;
}
