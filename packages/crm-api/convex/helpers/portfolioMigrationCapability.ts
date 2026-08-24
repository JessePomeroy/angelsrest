export type PortfolioMigrationPurpose =
	| "portfolio-media-attest-v1"
	| "sanity-portfolio-import-v1"
	| "sanity-portfolio-publish-v1"
	| "portfolio-pinned-restore-v1";

export type PortfolioMigrationCapabilityScope = {
	siteUrl: string;
	purpose: PortfolioMigrationPurpose;
	binding: string;
};

const DISABLED_ERROR = "Portfolio migration capability is disabled for this deployment";

/** Build one private capability bound to an exact tenant, phase, and digest. */
export function portfolioMigrationCapabilityFor(scope: PortfolioMigrationCapabilityScope) {
	return `portfolio-migration:v1:${JSON.stringify([
		scope.siteUrl,
		scope.purpose,
		scope.binding,
	])}`;
}

/** Fail closed unless the runtime has the exact phase-local capability. */
export function assertPortfolioMigrationCapability(
	scope: PortfolioMigrationCapabilityScope,
	configuredCapability: string | null | undefined = process.env.PORTFOLIO_MIGRATION_CAPABILITY,
) {
	if (configuredCapability !== portfolioMigrationCapabilityFor(scope)) {
		throw new Error(DISABLED_ERROR);
	}
}
