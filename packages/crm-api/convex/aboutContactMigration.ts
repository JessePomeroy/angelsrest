import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { assertAboutContactMigrationCapability } from "./helpers/aboutContactMigrationCapability";
import {
	aboutContactPinnedRestoreEntryValidator,
	attestAboutContactMediaSource,
	digestAboutContactMediaAttestation,
	digestAboutContactRestoreRequest,
	importSanityAboutContactDrafts,
	publishSanityAboutContactDrafts,
	restorePinnedAboutContactRevisions,
} from "./helpers/aboutContactMigrationStore";
import { sanityAboutContactPlanValidator } from "./helpers/sanityAboutContactPlan";

/** Operator-only, receipt-bound source-hash attestation for one ready media asset. */
export const attestMediaSource = internalMutation({
	args: {
		siteUrl: v.string(),
		mediaAssetId: v.id("mediaAssets"),
		workerAssetId: v.string(),
		sourceSha256: v.string(),
		sourceWidth: v.number(),
		sourceHeight: v.number(),
		receiptDigest: v.string(),
	},
	handler: async (ctx, args) => {
		const binding = await digestAboutContactMediaAttestation(args);
		assertAboutContactMigrationCapability({
			siteUrl: args.siteUrl,
			purpose: "about-contact-media-attest-v1",
			binding,
		});
		return await attestAboutContactMediaSource(ctx, args);
	},
});

/** Operator-only exact-pair import; no public or browser wrapper exists. */
export const importDrafts = internalMutation({
	args: {
		plan: sanityAboutContactPlanValidator,
		digest: v.string(),
	},
	handler: async (ctx, args) => {
		assertAboutContactMigrationCapability({
			siteUrl: args.plan.siteUrl,
			purpose: "sanity-about-contact-import-v1",
			binding: args.digest,
		});
		return await importSanityAboutContactDrafts(ctx, args);
	},
});

/** Operator-only exact-pair publication; no public or browser wrapper exists. */
export const publishDrafts = internalMutation({
	args: {
		plan: sanityAboutContactPlanValidator,
		digest: v.string(),
	},
	handler: async (ctx, args) => {
		assertAboutContactMigrationCapability({
			siteUrl: args.plan.siteUrl,
			purpose: "sanity-about-contact-publish-v1",
			binding: args.digest,
		});
		return await publishSanityAboutContactDrafts(ctx, args);
	},
});

/** Operator-only atomic publication cloned from one exact pinned pair. */
export const restorePinnedPublishedRevisions = internalMutation({
	args: {
		siteUrl: v.string(),
		operationId: v.string(),
		entries: v.array(aboutContactPinnedRestoreEntryValidator),
	},
	handler: async (ctx, args) => {
		const digest = await digestAboutContactRestoreRequest(
			args.siteUrl,
			args.operationId,
			args.entries,
		);
		assertAboutContactMigrationCapability({
			siteUrl: args.siteUrl,
			purpose: "about-contact-pinned-restore-v1",
			binding: digest,
		});
		return await restorePinnedAboutContactRevisions(ctx, args);
	},
});
