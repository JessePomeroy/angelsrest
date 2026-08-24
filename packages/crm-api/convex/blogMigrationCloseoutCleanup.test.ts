import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("completed Blog migration writer cleanup", () => {
	test("removes callable writers while retaining restore and historical custody", () => {
		for (const path of [
			"packages/crm-api/convex/blogMigrationDormancy.test.ts",
			"packages/crm-api/convex/sanityBlogReconciliation.ts",
			"scripts/cms/sanity-blog-import.ts",
			"scripts/cms/sanity-blog-reconciliation.ts",
			"scripts/cms/sanity-blog-publication.ts",
			"scripts/cms/sanityBlogReconciliationOperator.ts",
			"scripts/cms/sanityBlogReconciliationOperator.test.ts",
			"scripts/cms/sanityBlogPublicationOperator.ts",
			"scripts/cms/sanityBlogPublicationOperator.test.ts",
		]) {
			expect(existsSync(resolve(root, path))).toBe(false);
		}

		const blogContent = source("packages/crm-api/convex/blogContent.ts");
		expect(blogContent).not.toContain("importSanityBlogDrafts");
		expect(blogContent).toContain("restorePinnedPublishedRevisions");

		const capability = source(
			"packages/crm-api/convex/helpers/blogMigrationCapability.ts",
		);
		expect(capability).toContain('"blog-pinned-restore-v1"');
		for (const retiredPurpose of [
			"sanity-blog-import-v1",
			"sanity-blog-reconcile-v2",
			"sanity-blog-compact-v1",
		]) {
			expect(capability).not.toContain(retiredPurpose);
		}

		const packageJson = JSON.parse(source("package.json")) as {
			scripts: Record<string, string>;
		};
		expect(packageJson.scripts["cms:blog-import"]).toBeUndefined();
		expect(packageJson.scripts["cms:blog-import-dry-run"]).toBeDefined();

		const compactPlan = source("scripts/cms/sanity-blog-compact-plan.ts");
		expect(compactPlan).not.toContain("blogMigrationCapabilityFor");
		expect(compactPlan).not.toContain("migrationCapability:");

		for (const path of [
			"packages/crm-api/convex/helpers/blogPinnedRestore.ts",
			"packages/crm-api/convex/blogPinnedRestore.test.ts",
			"packages/crm-api/convex/helpers/sanityBlogImport.ts",
			"packages/crm-api/convex/helpers/sanityBlogImportPlan.ts",
			"packages/crm-api/convex/helpers/sanityBlogImportStore.ts",
			"packages/crm-api/convex/sanityBlogImportStore.test.ts",
			"packages/crm-api/convex/helpers/sanityBlogReconciliationStore.ts",
			"packages/crm-api/convex/sanityBlogReconciliationStore.test.ts",
			"packages/crm-api/convex/helpers/sanityBlogPublicationStore.ts",
			"packages/crm-api/convex/sanityBlogPublicationStore.test.ts",
			"scripts/cms/sanity-blog-import-dry-run.ts",
			"scripts/cms/sanityBlogImportPrep.ts",
			"scripts/cms/sanityBlogMediaTransfer.ts",
			"scripts/cms/sanityBlogMediaVerification.ts",
			"src/lib/server/blogContent.server.ts",
		]) {
			expect(existsSync(resolve(root, path))).toBe(true);
		}
	});
});
