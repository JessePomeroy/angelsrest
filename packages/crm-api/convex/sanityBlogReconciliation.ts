import { v } from "convex/values";
import { internalMutation } from "./_generated/server";
import { assertBlogMigrationCapability } from "./helpers/blogMigrationCapability";
import { ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE } from "./helpers/sanityBlogImportPlan";
import { sanityBlogReconciliationPlanValidator } from "./helpers/sanityBlogReconciliationPlan";
import { reconcileSanityBlogDrafts } from "./helpers/sanityBlogReconciliationStore";

/** Operator-only: no public mutation or browser-reachable wrapper exists. */
export const reconcileDrafts = internalMutation({
	args: {
		plan: sanityBlogReconciliationPlanValidator,
		digest: v.string(),
	},
	handler: async (ctx, args) => {
		assertBlogMigrationCapability({
			siteUrl: args.plan.siteUrl,
			purpose: "sanity-blog-reconcile-v2",
			binding: args.digest,
		});
		return await reconcileSanityBlogDrafts(ctx, {
			...args,
			predecessorContract: ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE,
		});
	},
});
