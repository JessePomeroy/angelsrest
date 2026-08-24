import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("completed About/Contact migration writer cleanup", () => {
	test("removes callable writers while retaining restore and historical custody", () => {
		for (const path of [
			"scripts/cms/sanity-about-contact-plan.ts",
			"scripts/cms/sanityAboutContactPlanOperator.ts",
			"scripts/cms/sanityAboutContactPlanOperator.test.ts",
		]) {
			expect(existsSync(resolve(root, path))).toBe(false);
		}

		const migration = source("packages/crm-api/convex/aboutContactMigration.ts");
		for (const retiredWriter of ["attestMediaSource", "importDrafts", "publishDrafts"]) {
			expect(migration).not.toContain(retiredWriter);
		}
		expect(migration).toContain("restorePinnedPublishedRevisions");

		const capability = source(
			"packages/crm-api/convex/helpers/aboutContactMigrationCapability.ts",
		);
		expect(capability).toContain('"about-contact-pinned-restore-v1"');
		for (const retiredPurpose of [
			"about-contact-media-attest-v1",
			"sanity-about-contact-import-v1",
			"sanity-about-contact-publish-v1",
		]) {
			expect(capability).not.toContain(retiredPurpose);
		}

		const packageJson = JSON.parse(source("package.json")) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts["cms:about-contact-plan"]).toBeUndefined();

		for (const path of [
			"packages/crm-api/convex/helpers/aboutContactMigrationStore.ts",
			"packages/crm-api/convex/helpers/sanityAboutContactPlan.ts",
			"packages/crm-api/convex/sanityAboutContactPlan.test.ts",
			"packages/crm-api/convex/content.ts",
			"packages/crm-api/convex/aboutPage.test.ts",
			"packages/crm-api/convex/contactPage.test.ts",
			"scripts/cms/about-contact-portrait-transfer.ts",
			"scripts/cms/aboutContactPortraitTransfer.ts",
			"scripts/cms/aboutContactPortraitTransfer.test.ts",
			"src/lib/server/aboutContactContent.server.ts",
			"src/lib/server/__tests__/aboutContactContent.test.ts",
			"src/routes/about/+page.server.ts",
			"src/routes/admin/editor/pages/about/+page.svelte",
			"src/routes/admin/editor/pages/contact/+page.svelte",
			"src/routes/api/contact/+server.ts",
		]) {
			expect(existsSync(resolve(root, path))).toBe(true);
		}

		expect(source("packages/crm-api/convex/content.ts")).toContain(
			"fixed-pair publication",
		);
	});
});
