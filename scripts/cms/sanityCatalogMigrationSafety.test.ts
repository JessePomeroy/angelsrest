import { describe, expect, test } from "vitest";
import {
	createSanityCatalogImportDryRunReport,
	createSanityCatalogImportManifest,
	type SanityCatalogImportDryRunReport,
} from "../../packages/crm-api/convex/helpers/sanityCatalogImport";
import {
	ANGELSREST_CATALOG_BASELINE,
	checkAngelsRestCatalogBaseline,
} from "./migrations/angelsrest-catalog/catalogBaseline";
import { resolveCatalogDryRunOutputPath } from "./sanityCatalogDryRunSafety";

function reviewedBaselineReport(): SanityCatalogImportDryRunReport {
	return {
		version: 1,
		counts: {
			products: ANGELSREST_CATALOG_BASELINE.products,
			productsByKind: {
				print: ANGELSREST_CATALOG_BASELINE.prints,
				print_set: ANGELSREST_CATALOG_BASELINE.printSets,
				postcard: ANGELSREST_CATALOG_BASELINE.postcards,
				tapestry: ANGELSREST_CATALOG_BASELINE.tapestries,
				digital_download: ANGELSREST_CATALOG_BASELINE.digitalDownloads,
				merchandise: ANGELSREST_CATALOG_BASELINE.merchandise,
				unsupported: ANGELSREST_CATALOG_BASELINE.unsupported,
			},
			sourceExplicitVariants: ANGELSREST_CATALOG_BASELINE.sourceExplicitVariants,
			normalizedVariants: ANGELSREST_CATALOG_BASELINE.normalizedVariants,
			mediaPlacements: ANGELSREST_CATALOG_BASELINE.mediaPlacements,
			uniqueSourceImages: ANGELSREST_CATALOG_BASELINE.uniqueSourceImages,
			printSourcePlacements: ANGELSREST_CATALOG_BASELINE.printSourcePlacements,
			uniquePrintSourceImages: ANGELSREST_CATALOG_BASELINE.uniquePrintSourceImages,
			printSetMembers: ANGELSREST_CATALOG_BASELINE.printSetMembers,
			digitalFiles: ANGELSREST_CATALOG_BASELINE.digitalFiles,
			compatibilityDefaultsApplied: ANGELSREST_CATALOG_BASELINE.compatibilityDefaultsApplied,
			collections: ANGELSREST_CATALOG_BASELINE.collections,
			coupons: ANGELSREST_CATALOG_BASELINE.coupons,
		},
		requiredSourceImageRefs: [],
		requiredPrintSourceImageRefs: [],
		requiredSourceFileRefs: [],
		draftImport: {
			status: "ready-with-warnings",
			counts: {
				errors: ANGELSREST_CATALOG_BASELINE.draftErrors,
				warnings: ANGELSREST_CATALOG_BASELINE.draftWarnings,
			},
			blockingIssues: [],
			warningIssues: [],
			issues: [],
		},
		publicationRemediation: {
			status: "ready-with-warnings",
			counts: {
				errors: ANGELSREST_CATALOG_BASELINE.publicationErrors,
				warnings: ANGELSREST_CATALOG_BASELINE.publicationWarnings,
			},
			blockingIssues: [],
			warningIssues: [],
			issues: [],
		},
	};
}

describe("Angels Rest catalog dry-run safety", () => {
	test("matches only the reviewed complete-catalog baseline", () => {
		expect(checkAngelsRestCatalogBaseline(reviewedBaselineReport())).toEqual({
			status: "matched",
			mismatches: [],
		});
	});

	test("rejects an empty source even when the generic adapter can parse it", () => {
		const report = createSanityCatalogImportDryRunReport(
			createSanityCatalogImportManifest({
				prints: [],
				sets: [],
				general: [],
				collections: [],
				coupons: [],
			}),
		);
		const baseline = checkAngelsRestCatalogBaseline(report);

		expect(report.draftImport.status).toBe("ready");
		expect(baseline.status).toBe("drifted");
		expect(baseline.mismatches).toContain("products: expected 33, received 0");
	});

	test("accepts only report files directly beneath /tmp", () => {
		expect(resolveCatalogDryRunOutputPath("/tmp/catalog-report.json")).toBe(
			"/tmp/catalog-report.json",
		);
		expect(() => resolveCatalogDryRunOutputPath("/tmp/nested/catalog-report.json")).toThrow(
			"direct children of /tmp",
		);
		expect(() => resolveCatalogDryRunOutputPath("/tmp/../catalog-report.json")).toThrow(
			"direct children of /tmp",
		);
		expect(() => resolveCatalogDryRunOutputPath("./catalog-report.json")).toThrow(
			"direct children of /tmp",
		);
	});
});
