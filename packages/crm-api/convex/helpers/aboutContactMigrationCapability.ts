export type AboutContactMigrationPurpose =
	| "about-contact-media-attest-v1"
	| "about-contact-pinned-restore-v1"
	| "sanity-about-contact-publish-v1"
	| "sanity-about-contact-import-v1";

export type AboutContactMigrationCapabilityScope = {
	siteUrl: string;
	purpose: AboutContactMigrationPurpose;
	binding: string;
};

const DISABLED_ERROR =
	"About and Contact migration capability is disabled for this deployment";

/** Build one collision-free capability bound to an exact tenant and operation. */
export function aboutContactMigrationCapabilityFor(
	scope: AboutContactMigrationCapabilityScope,
) {
	return `about-contact-migration:v1:${JSON.stringify([
		scope.siteUrl,
		scope.purpose,
		scope.binding,
	])}`;
}

/** Fail closed unless the runtime carries the one exact private capability. */
export function assertAboutContactMigrationCapability(
	scope: AboutContactMigrationCapabilityScope,
	configuredCapability: string | null | undefined =
		process.env.ABOUT_CONTACT_MIGRATION_CAPABILITY,
) {
	if (configuredCapability !== aboutContactMigrationCapabilityFor(scope)) {
		throw new Error(DISABLED_ERROR);
	}
}
