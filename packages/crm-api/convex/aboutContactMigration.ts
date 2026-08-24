import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { assertAboutContactMigrationCapability } from "./helpers/aboutContactMigrationCapability";
import {
	aboutContactPinnedRestoreEntryValidator,
	digestAboutContactRestoreRequest,
	restorePinnedAboutContactRevisions,
} from "./helpers/aboutContactMigrationStore";

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
