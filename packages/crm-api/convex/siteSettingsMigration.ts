import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { assertSiteSettingsMigrationCapability } from "./helpers/siteSettingsMigrationCapability";
import {
	digestSiteSettingsRestoreRequest,
	restorePinnedSiteSettingsRevision,
	siteSettingsPinnedRestoreEntryValidator,
} from "./helpers/siteSettingsMigrationStore";

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
