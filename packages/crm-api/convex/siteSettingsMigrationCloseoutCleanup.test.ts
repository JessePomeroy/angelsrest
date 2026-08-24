import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("completed Site Settings migration writer cleanup", () => {
	test("removes callable writers while retaining restore and historical custody", () => {
		const migration = source("packages/crm-api/convex/siteSettingsMigration.ts");
		for (const retiredWriter of ["attestMediaSource", "importDraft", "publishDraft"]) {
			expect(migration).not.toContain(retiredWriter);
		}
		expect(migration).toContain("restorePinnedPublishedRevision");

		const capability = source(
			"packages/crm-api/convex/helpers/siteSettingsMigrationCapability.ts",
		);
		expect(capability).toContain('"site-settings-pinned-restore-v1"');
		for (const retiredPurpose of [
			"site-settings-media-attest-v1",
			"sanity-site-settings-import-v1",
			"sanity-site-settings-publish-v1",
		]) {
			expect(capability).not.toContain(retiredPurpose);
		}

		for (const path of [
			"packages/crm-api/convex/helpers/angelsRestSiteSettingsMigration.ts",
			"packages/crm-api/convex/helpers/sanitySiteSettingsPlan.ts",
			"packages/crm-api/convex/helpers/siteSettingsData.ts",
			"packages/crm-api/convex/helpers/siteSettingsMigrationStore.ts",
			"packages/crm-api/convex/sanitySiteSettingsPlan.test.ts",
			"packages/crm-api/convex/content.ts",
			"packages/crm-api/convex/content.test.ts",
			"packages/crm-api/convex/mediaAssets.ts",
			"packages/crm-api/convex/_generated/api.d.ts",
			"packages/crm-api/convex/_generated/api.js",
			"scripts/cms/site-settings-og-transfer-helper.ts",
			"scripts/cms/site-settings-og-transfer.test.ts",
			"scripts/cms/site-settings-og-transfer.ts",
			"src/lib/config/admin.ts",
			"src/lib/server/siteSettingsContent.server.ts",
			"src/lib/server/__tests__/siteSettingsContent.test.ts",
			"src/routes/+layout.server.ts",
			"src/routes/admin/editor/+page.svelte",
		]) {
			expect(existsSync(resolve(root, path))).toBe(true);
		}

		const content = source("packages/crm-api/convex/content.ts");
		expect(content).toContain("isInitialSanitySiteSettingsImport");
		expect(content).toContain("publishSiteSettings");
		expect(source("src/lib/server/siteSettingsContent.server.ts")).toContain(
			"getPublishedSiteSettingsWithRevision",
		);
	});
});
