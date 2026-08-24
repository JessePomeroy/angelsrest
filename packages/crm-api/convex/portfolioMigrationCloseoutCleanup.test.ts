import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const root = process.cwd();
const source = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("completed Portfolio migration writer cleanup", () => {
	test("removes callable writers while retaining restore and shared Portfolio seams", () => {
		expect(
			existsSync(resolve(root, "packages/crm-api/convex/helpers/angelsRestPortfolioMigration.ts")),
		).toBe(false);

		const migration = source("packages/crm-api/convex/portfolioMigration.ts");
		for (const retiredWriter of ["attestMediaSources", "importDrafts", "publishDrafts"]) {
			expect(migration).not.toContain(retiredWriter);
		}
		expect(migration).toContain("restorePinnedPublishedRevisions");

		const capability = source("packages/crm-api/convex/helpers/portfolioMigrationCapability.ts");
		expect(capability).toContain('"portfolio-pinned-restore-v1"');
		for (const retiredPurpose of [
			"portfolio-media-attest-v1",
			"sanity-portfolio-import-v1",
			"sanity-portfolio-publish-v1",
		]) {
			expect(capability).not.toContain(retiredPurpose);
		}

		for (const path of [
			"packages/crm-api/convex/helpers/portfolioMigrationStore.ts",
			"packages/crm-api/convex/helpers/portfolioMigrationPlan.ts",
			"packages/crm-api/convex/helpers/portfolioData.ts",
			"packages/crm-api/convex/helpers/portfolioValidators.ts",
			"packages/crm-api/convex/portfolioGalleries.ts",
			"packages/crm-api/convex/portfolioGalleries.test.ts",
			"scripts/cms/migrations/angelsrest-portfolio/portfolio-media-transfer.ts",
			"scripts/cms/migrations/angelsrest-portfolio/portfolioAtomicState.ts",
			"scripts/cms/migrations/angelsrest-portfolio/portfolioMediaTransfer.ts",
			"scripts/cms/migrations/angelsrest-portfolio/portfolioMediaTransferPlan.ts",
			"scripts/cms/migrations/angelsrest-portfolio/portfolioMigrationPlanOperator.ts",
			"scripts/cms/migrations/angelsrest-portfolio/portfolioMediaTransfer.test.ts",
			"src/lib/config/admin.ts",
			"src/lib/server/portfolioContent.server.ts",
			"src/lib/server/__tests__/portfolioContent.test.ts",
			"src/routes/gallery/+page.server.ts",
			"src/routes/gallery/[slug]/+page.server.ts",
		]) {
			expect(existsSync(resolve(root, path))).toBe(true);
		}

		expect(source("packages/crm-api/convex/portfolioGalleries.ts")).toContain(
			"isInitialSanityPortfolioImport",
		);
		expect(source("src/lib/server/portfolioContent.server.ts")).toContain(
			"PORTFOLIO_CONTENT_PROVIDER",
		);
	});
});
