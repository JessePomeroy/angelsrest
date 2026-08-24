import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import {
	requireAngelsRestSiteSettingsMediaAttestation,
	requireAngelsRestSiteSettingsMigrationPlan,
} from "./helpers/angelsRestSiteSettingsMigration";
import { sanitySiteSettingsPlanValidator } from "./helpers/sanitySiteSettingsPlan";
import { assertSiteSettingsMigrationCapability } from "./helpers/siteSettingsMigrationCapability";
import {
	attestSiteSettingsMediaSource,
	digestSiteSettingsMediaAttestation,
	digestSiteSettingsRestoreRequest,
	importSanitySiteSettingsDraft,
	publishSanitySiteSettingsDraft,
	restorePinnedSiteSettingsRevision,
	siteSettingsPinnedRestoreEntryValidator,
} from "./helpers/siteSettingsMigrationStore";

/** Operator-only receipt-bound source attestation for the transferred OG image. */
export const attestMediaSource = internalMutation({
	args: {
		siteUrl: v.string(),
		mediaAssetId: v.id("mediaAssets"),
		workerAssetId: v.string(),
		sourceAssetRef: v.string(),
		sourceSha256: v.string(),
		receiptDigest: v.string(),
	},
	handler: async (ctx, args) => {
		const binding = await digestSiteSettingsMediaAttestation(args);
		assertSiteSettingsMigrationCapability({
			siteUrl: args.siteUrl,
			purpose: "site-settings-media-attest-v1",
			binding,
		});
		requireAngelsRestSiteSettingsMediaAttestation(args);
		return await attestSiteSettingsMediaSource(ctx, args);
	},
});

/** Operator-only exact singleton import; no public or browser wrapper exists. */
export const importDraft = internalMutation({
	args: {
		plan: sanitySiteSettingsPlanValidator,
		digest: v.string(),
	},
	handler: async (ctx, args) => {
		assertSiteSettingsMigrationCapability({
			siteUrl: args.plan.siteUrl,
			purpose: "sanity-site-settings-import-v1",
			binding: args.digest,
		});
		await requireAngelsRestSiteSettingsMigrationPlan(args.plan, args.digest);
		return await importSanitySiteSettingsDraft(ctx, args);
	},
});

/** Operator-only exact singleton publication; no public or browser wrapper exists. */
export const publishDraft = internalMutation({
	args: {
		plan: sanitySiteSettingsPlanValidator,
		digest: v.string(),
	},
	handler: async (ctx, args) => {
		assertSiteSettingsMigrationCapability({
			siteUrl: args.plan.siteUrl,
			purpose: "sanity-site-settings-publish-v1",
			binding: args.digest,
		});
		await requireAngelsRestSiteSettingsMigrationPlan(args.plan, args.digest);
		return await publishSanitySiteSettingsDraft(ctx, args);
	},
});

/** Operator-only publication cloned from one exact pinned Site Settings revision. */
export const restorePinnedPublishedRevision = internalMutation({
	args: {
		siteUrl: v.string(),
		operationId: v.string(),
		entry: siteSettingsPinnedRestoreEntryValidator,
	},
	handler: async (ctx, args) => {
		const digest = await digestSiteSettingsRestoreRequest(
			args.siteUrl,
			args.operationId,
			args.entry,
		);
		assertSiteSettingsMigrationCapability({
			siteUrl: args.siteUrl,
			purpose: "site-settings-pinned-restore-v1",
			binding: digest,
		});
		return await restorePinnedSiteSettingsRevision(ctx, args);
	},
});
