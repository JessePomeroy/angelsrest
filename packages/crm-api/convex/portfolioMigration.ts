import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { assertPortfolioMigrationCapability } from "./helpers/portfolioMigrationCapability";
import {
	digestPortfolioRestoreRequest,
	portfolioPinnedRestoreEntryValidator,
	restorePinnedPortfolioRevisions,
} from "./helpers/portfolioMigrationStore";

/** Operator-only graph restore cloned from exact pinned published revisions. */
export const restorePinnedPublishedRevisions = internalMutation({
	args: {
		siteUrl: v.string(),
		operationId: v.string(),
		entries: v.array(portfolioPinnedRestoreEntryValidator),
	},
	handler: async (ctx, args) => {
		const binding = await digestPortfolioRestoreRequest(
			args.siteUrl,
			args.operationId,
			args.entries,
		);
		assertPortfolioMigrationCapability({
			siteUrl: args.siteUrl,
			purpose: "portfolio-pinned-restore-v1",
			binding,
		});
		return await restorePinnedPortfolioRevisions(ctx, args);
	},
});
