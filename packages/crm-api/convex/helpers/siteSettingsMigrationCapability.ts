export type SiteSettingsMigrationPurpose = "site-settings-pinned-restore-v1";

export type SiteSettingsMigrationCapabilityScope = {
	siteUrl: string;
	purpose: SiteSettingsMigrationPurpose;
	binding: string;
};

const DISABLED_ERROR = "Site Settings migration capability is disabled for this deployment";

/** Build one capability bound to an exact tenant, phase, and operation digest. */
export function siteSettingsMigrationCapabilityFor(
	scope: SiteSettingsMigrationCapabilityScope,
) {
	return `site-settings-migration:v1:${JSON.stringify([
		scope.siteUrl,
		scope.purpose,
		scope.binding,
	])}`;
}

/** Fail closed unless the runtime carries the one exact private capability. */
export function assertSiteSettingsMigrationCapability(
	scope: SiteSettingsMigrationCapabilityScope,
	configuredCapability: string | null | undefined =
		process.env.SITE_SETTINGS_MIGRATION_CAPABILITY,
) {
	if (configuredCapability !== siteSettingsMigrationCapabilityFor(scope)) {
		throw new Error(DISABLED_ERROR);
	}
}
