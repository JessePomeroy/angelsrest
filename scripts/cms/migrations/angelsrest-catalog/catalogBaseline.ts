import type { SanityCatalogImportDryRunReport } from "../../../../packages/crm-api/convex/helpers/sanityCatalogImport";

export const ANGELSREST_CATALOG_BASELINE = {
	products: 33,
	prints: 11,
	printSets: 2,
	postcards: 0,
	tapestries: 19,
	digitalDownloads: 1,
	merchandise: 0,
	unsupported: 0,
	sourceExplicitVariants: 49,
	normalizedVariants: 69,
	mediaPlacements: 38,
	uniqueSourceImages: 33,
	printSourcePlacements: 16,
	uniquePrintSourceImages: 11,
	printSetMembers: 5,
	digitalFiles: 1,
	compatibilityDefaultsApplied: 14,
	collections: 0,
	coupons: 0,
	draftErrors: 0,
	draftWarnings: 38,
	publicationErrors: 0,
	publicationWarnings: 38,
} as const;

export type AngelsRestCatalogBaselineCheck = {
	status: "matched" | "drifted";
	mismatches: string[];
};

export function checkAngelsRestCatalogBaseline(
	report: SanityCatalogImportDryRunReport,
): AngelsRestCatalogBaselineCheck {
	const kinds = report.counts.productsByKind;
	const checks: Array<readonly [string, number, number]> = [
		["products", ANGELSREST_CATALOG_BASELINE.products, report.counts.products],
		["prints", ANGELSREST_CATALOG_BASELINE.prints, kinds.print],
		["printSets", ANGELSREST_CATALOG_BASELINE.printSets, kinds.print_set],
		["postcards", ANGELSREST_CATALOG_BASELINE.postcards, kinds.postcard],
		["tapestries", ANGELSREST_CATALOG_BASELINE.tapestries, kinds.tapestry],
		["digitalDownloads", ANGELSREST_CATALOG_BASELINE.digitalDownloads, kinds.digital_download],
		["merchandise", ANGELSREST_CATALOG_BASELINE.merchandise, kinds.merchandise],
		["unsupported", ANGELSREST_CATALOG_BASELINE.unsupported, kinds.unsupported],
		[
			"sourceExplicitVariants",
			ANGELSREST_CATALOG_BASELINE.sourceExplicitVariants,
			report.counts.sourceExplicitVariants,
		],
		[
			"normalizedVariants",
			ANGELSREST_CATALOG_BASELINE.normalizedVariants,
			report.counts.normalizedVariants,
		],
		["mediaPlacements", ANGELSREST_CATALOG_BASELINE.mediaPlacements, report.counts.mediaPlacements],
		[
			"uniqueSourceImages",
			ANGELSREST_CATALOG_BASELINE.uniqueSourceImages,
			report.counts.uniqueSourceImages,
		],
		[
			"printSourcePlacements",
			ANGELSREST_CATALOG_BASELINE.printSourcePlacements,
			report.counts.printSourcePlacements,
		],
		[
			"uniquePrintSourceImages",
			ANGELSREST_CATALOG_BASELINE.uniquePrintSourceImages,
			report.counts.uniquePrintSourceImages,
		],
		["printSetMembers", ANGELSREST_CATALOG_BASELINE.printSetMembers, report.counts.printSetMembers],
		["digitalFiles", ANGELSREST_CATALOG_BASELINE.digitalFiles, report.counts.digitalFiles],
		[
			"compatibilityDefaultsApplied",
			ANGELSREST_CATALOG_BASELINE.compatibilityDefaultsApplied,
			report.counts.compatibilityDefaultsApplied,
		],
		["collections", ANGELSREST_CATALOG_BASELINE.collections, report.counts.collections],
		["coupons", ANGELSREST_CATALOG_BASELINE.coupons, report.counts.coupons],
		["draftErrors", ANGELSREST_CATALOG_BASELINE.draftErrors, report.draftImport.counts.errors],
		[
			"draftWarnings",
			ANGELSREST_CATALOG_BASELINE.draftWarnings,
			report.draftImport.counts.warnings,
		],
		[
			"publicationErrors",
			ANGELSREST_CATALOG_BASELINE.publicationErrors,
			report.publicationRemediation.counts.errors,
		],
		[
			"publicationWarnings",
			ANGELSREST_CATALOG_BASELINE.publicationWarnings,
			report.publicationRemediation.counts.warnings,
		],
	];
	const mismatches = checks.flatMap(([field, expected, actual]) =>
		expected === actual ? [] : [`${field}: expected ${expected}, received ${actual}`],
	);
	return { status: mismatches.length === 0 ? "matched" : "drifted", mismatches };
}
