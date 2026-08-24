import {
	requirePortfolioMigrationPlan,
	type PortfolioMigrationPlan,
} from "./portfolioMigrationPlan";

/**
 * Fixed binding for the owner-approved, sealed Portfolio migration manifest.
 * Import, attestation, and publication reject every other plan digest.
 */
export const ANGELS_REST_PORTFOLIO_PLAN_DIGEST: string | null =
	"12e03d01aabee515c9073fc31a4d0cba531c8764d36e801f373d4d12cb053ad5";

export async function requireAngelsRestPortfolioMigrationPlan(
	plan: PortfolioMigrationPlan,
	digest: string,
) {
	if (
		ANGELS_REST_PORTFOLIO_PLAN_DIGEST === null
		|| plan.siteUrl !== "angelsrest.online"
		|| digest !== ANGELS_REST_PORTFOLIO_PLAN_DIGEST
	) throw new Error("Portfolio migration has no accepted live manifest binding");
	return await requirePortfolioMigrationPlan(plan, digest);
}
