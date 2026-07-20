import { rm, writeFile } from "node:fs/promises";
import { createClient } from "@sanity/client";
import {
	createSanityCatalogImportDryRunReport,
	createSanityCatalogImportManifest,
	type SanityCatalogImportManifest,
} from "../../packages/crm-api/convex/helpers/sanityCatalogImport";
import { checkAngelsRestCatalogBaseline } from "./migrations/angelsrest-catalog/catalogBaseline";
import { resolveCatalogDryRunOutputPath } from "./sanityCatalogDryRunSafety";
import { fetchPublishedSanityCatalogSource } from "./sanityCatalogSource";
import { readSanitySourceConfig } from "./sanitySourceConfig";

const DEFAULT_OUTPUT_PATH = "/tmp/angelsrest-sanity-catalog-import-report.json";

function outputPath(args: string[]) {
	let path = DEFAULT_OUTPUT_PATH;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--output") {
			path = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	return resolveCatalogDryRunOutputPath(path);
}

function sanitizedProducts(manifest: SanityCatalogImportManifest) {
	return manifest.products.map((product) => ({
		sourceId: product.sourceId,
		sourceType: product.sourceType,
		sourceRevision: product.sourceRevision ?? null,
		sourceCreatedAt: product.sourceCreatedAt ?? null,
		sourceUpdatedAt: product.sourceUpdatedAt ?? null,
		productKey: product.productKey,
		kind: product.kind,
		slug: product.slug ?? null,
		fulfillmentMode: product.fulfillmentMode,
		saleAvailability: product.saleAvailability,
		shopPlacement: product.shopPlacement,
		variants: product.variants.map((variant) => ({
			key: variant.key,
			origin: variant.origin,
			materialOptionKey: variant.materialOptionKey ?? null,
			sizeOptionKey: variant.sizeOptionKey ?? null,
			retailPriceCents: variant.retailPriceCents ?? null,
			status: variant.status,
		})),
		media: product.media.map((placement) => ({
			key: placement.key,
			role: placement.role,
			order: placement.order,
			sourceAssetRef: placement.sourceAssetRef,
			hasAltText: Boolean(placement.altText),
			printSource: placement.printSource,
		})),
		printSetMembers: product.printSetMembers ?? [],
		sourceCollectionId: product.sourceCollectionId ?? null,
		digitalFile: product.digitalFile
			? {
					sourceFileRef: product.digitalFile.sourceFileRef,
					sourceAssetId: product.digitalFile.sourceAssetId,
					originalFilename: product.digitalFile.originalFilename,
					mimeType: product.digitalFile.mimeType,
					sizeBytes: product.digitalFile.sizeBytes,
					version: product.digitalFile.version ?? null,
				}
			: null,
		normalizations: product.normalizations,
		issueCount: product.issues.length,
	}));
}

async function main() {
	const reportPath = outputPath(process.argv.slice(2));
	const { projectId, dataset } = await readSanitySourceConfig(process.cwd());
	const client = createClient({
		projectId,
		dataset,
		apiVersion: "2024-01-01",
		useCdn: false,
	});
	const source = await fetchPublishedSanityCatalogSource(client);
	const manifest = createSanityCatalogImportManifest(source);
	const report = createSanityCatalogImportDryRunReport(manifest);
	const baseline = checkAngelsRestCatalogBaseline(report);
	const output = {
		generatedAt: new Date().toISOString(),
		source: {
			projectId,
			dataset,
			perspective: "published",
		},
		report,
		baseline,
		products: sanitizedProducts(manifest),
	};
	await rm(reportPath, { force: true });
	await writeFile(reportPath, `${JSON.stringify(output, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	const kinds = report.counts.productsByKind;
	console.log(
		`Wrote Sanity catalog import dry-run report to ${reportPath}: baseline ${baseline.status}; draft import ${report.draftImport.status}; publication remediation ${report.publicationRemediation.status}; ${report.counts.products} products (${kinds.print} prints, ${kinds.print_set} sets, ${kinds.tapestry} tapestries, ${kinds.digital_download} digital); ${report.counts.mediaPlacements} media placements; ${report.counts.normalizedVariants} normalized variants`,
	);
	if (baseline.status === "drifted" || report.draftImport.status === "blocked")
		process.exitCode = 1;
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
