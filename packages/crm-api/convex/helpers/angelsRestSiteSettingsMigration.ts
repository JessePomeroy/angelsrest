import type { Id } from "../_generated/dataModel";
import {
	requireSanitySiteSettingsPlan,
	type SanitySiteSettingsPlan,
} from "./sanitySiteSettingsPlan";

export const ANGELS_REST_SITE_SETTINGS_MIGRATION = {
	siteUrl: "angelsrest.online",
	sourceId: "cb989d2a-ad1f-457f-a3cd-cc01920e360b",
	sourceRevision: "wRXAq7rd73LcHaYpTqfURn",
	logoSourceAssetRef: "image-e5b859c8cf1fc41473f66d34c705b16b19e1c33c-32x32-png",
	seoOgSourceAssetRef:
		"image-0ccd0a41f44c6387c01425cd93579ac5a4a9f341-1848x1848-png",
	seoOgSourceSha256:
		"c4c238f25cd39d63f55692fefde0a4bd11ff1a9cfd232e94e2dcd952d0fb6d97",
	seoOgMediaAssetId: "nh7dr8ckx5q504vbj13nzer7pn8d2zfb" as Id<"mediaAssets">,
	seoOgWorkerAssetId: "2f459513-e847-4a32-a5ef-09ab36040e8b",
	seoOgReceiptDigest:
		"3a8b2172fae3a6291395f0c6e48df5eb15903ea6144eb669710ea15361cda265",
	seoOgReceiptFileSha256:
		"17653aaa1284bd5ffa0e4134777f2707a748632b3bec81c15b3c493c728d9e95",
	mediaAttestationDigest:
		"7fcc708f2862f5783ddfd452ae485ef17853bc46be870055c55fa9f7a9f08dbe",
	planDigest: "a7312765ee142e26ea6130e554a631c2a733e2387f085e2fd7091a9097c2224b",
} as const;

export async function requireAngelsRestSiteSettingsMigrationPlan(
	plan: SanitySiteSettingsPlan,
	digest: string,
) {
	if (
		digest !== ANGELS_REST_SITE_SETTINGS_MIGRATION.planDigest
		|| plan.siteUrl !== ANGELS_REST_SITE_SETTINGS_MIGRATION.siteUrl
		|| plan.sourceDocument.sourceId !== ANGELS_REST_SITE_SETTINGS_MIGRATION.sourceId
		|| plan.sourceDocument.sourceRevision
			!== ANGELS_REST_SITE_SETTINGS_MIGRATION.sourceRevision
	) throw new Error("Site Settings migration plan is not the accepted live binding");
	return await requireSanitySiteSettingsPlan(plan, digest);
}

export function requireAngelsRestSiteSettingsMediaAttestation(args: {
	siteUrl: string;
	mediaAssetId: Id<"mediaAssets">;
	workerAssetId: string;
	sourceAssetRef: string;
	sourceSha256: string;
	receiptDigest: string;
}) {
	if (
		args.siteUrl !== ANGELS_REST_SITE_SETTINGS_MIGRATION.siteUrl
		|| args.mediaAssetId !== ANGELS_REST_SITE_SETTINGS_MIGRATION.seoOgMediaAssetId
		|| args.workerAssetId !== ANGELS_REST_SITE_SETTINGS_MIGRATION.seoOgWorkerAssetId
		|| args.sourceAssetRef !== ANGELS_REST_SITE_SETTINGS_MIGRATION.seoOgSourceAssetRef
		|| args.sourceSha256 !== ANGELS_REST_SITE_SETTINGS_MIGRATION.seoOgSourceSha256
		|| args.receiptDigest !== ANGELS_REST_SITE_SETTINGS_MIGRATION.seoOgReceiptDigest
	) throw new Error("Site Settings media attestation is not the accepted receipt binding");
}
