import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { requireAngelsRestPortfolioMigrationPlan } from "./helpers/angelsRestPortfolioMigration";
import { assertPortfolioMigrationCapability } from "./helpers/portfolioMigrationCapability";
import { portfolioMigrationPlanValidator } from "./helpers/portfolioMigrationPlan";
import {
	attestPortfolioMediaSources,
	digestPortfolioRestoreRequest,
	importSanityPortfolioDrafts,
	portfolioPinnedRestoreEntryValidator,
	publishSanityPortfolioDrafts,
	restorePinnedPortfolioRevisions,
} from "./helpers/portfolioMigrationStore";

/** Operator-only receipt-bound attestation for the fixed Portfolio media set. */
export const attestMediaSources = internalMutation({
	args: { plan: portfolioMigrationPlanValidator, digest: v.string() },
	handler: async (ctx, args) => {
		await requireAngelsRestPortfolioMigrationPlan(args.plan, args.digest);
		assertPortfolioMigrationCapability({
			siteUrl: args.plan.siteUrl,
			purpose: "portfolio-media-attest-v1",
			binding: args.digest,
		});
		return await attestPortfolioMediaSources(ctx, args);
	},
});

/** Operator-only atomic exact-manifest import; no browser wrapper exists. */
export const importDrafts = internalMutation({
	args: { plan: portfolioMigrationPlanValidator, digest: v.string() },
	handler: async (ctx, args) => {
		await requireAngelsRestPortfolioMigrationPlan(args.plan, args.digest);
		assertPortfolioMigrationCapability({
			siteUrl: args.plan.siteUrl,
			purpose: "sanity-portfolio-import-v1",
			binding: args.digest,
		});
		return await importSanityPortfolioDrafts(ctx, args);
	},
});

/** Operator-only atomic fixed-manifest publication; no browser wrapper exists. */
export const publishDrafts = internalMutation({
	args: { plan: portfolioMigrationPlanValidator, digest: v.string() },
	handler: async (ctx, args) => {
		await requireAngelsRestPortfolioMigrationPlan(args.plan, args.digest);
		assertPortfolioMigrationCapability({
			siteUrl: args.plan.siteUrl,
			purpose: "sanity-portfolio-publish-v1",
			binding: args.digest,
		});
		return await publishSanityPortfolioDrafts(ctx, args);
	},
});

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
