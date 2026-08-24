export type BlogMigrationPurpose = "blog-pinned-restore-v1";

export type BlogMigrationCapabilityScope = {
	siteUrl: string;
	purpose: BlogMigrationPurpose;
	binding: string;
};

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
 * Fail closed unless the runtime carries the one exact, private capability.
 */
export function assertBlogMigrationCapability(
	scope: BlogMigrationCapabilityScope,
	configuredCapability: string | null | undefined = process.env.BLOG_MIGRATION_CAPABILITY,
) {
	if (configuredCapability !== blogMigrationCapabilityFor(scope)) {
		throw new Error(DISABLED_ERROR);
	}
}
