export type BlogMigrationPurpose =
	| "blog-pinned-restore-v1"
	| "sanity-blog-import-v1"
	| "sanity-blog-reconcile-v2";

export type BlogMigrationCapabilityScope = {
	siteUrl: string;
	purpose: BlogMigrationPurpose;
	binding: string;
};

const DEPLOYED_BLOG_MIGRATION_CAPABILITY: string | null = null;
const DISABLED_ERROR = "Blog migration capability is disabled for this deployment";

/** Build one collision-free capability bound to an exact tenant and operation. */
export function blogMigrationCapabilityFor(
	scope: BlogMigrationCapabilityScope,
) {
	return `blog-migration:v1:${JSON.stringify([
		scope.siteUrl,
		scope.purpose,
		scope.binding,
	])}`;
}

/**
 * Fail closed in the dormant deployment. A future migration deployment must
 * deliberately inject the one exact reviewed capability into this pure gate.
 */
export function assertBlogMigrationCapability(
	scope: BlogMigrationCapabilityScope,
	configuredCapability: string | null = DEPLOYED_BLOG_MIGRATION_CAPABILITY,
) {
	if (configuredCapability !== blogMigrationCapabilityFor(scope)) {
		throw new Error(DISABLED_ERROR);
	}
}
