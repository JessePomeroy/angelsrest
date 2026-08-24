import {
	requirePortfolioMigrationPlan,
	type PortfolioMigrationPlan,
} from "./portfolioMigrationPlan";

/**
 * The dormant source unit intentionally carries no accepted live manifest.
 * The bounded inventory follow-up replaces only this null with its reviewed
 * full-plan digest; until then import, attestation, and publication stay closed.
 */
export const ANGELS_REST_PORTFOLIO_PLAN_DIGEST: string | null = null;

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
