import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createClient } from "@sanity/client";
import type { Id } from "../../packages/crm-api/convex/_generated/dataModel";
import {
	createSanityCatalogV2GraphPlan,
	type SanityCatalogV2TargetIdMaps,
} from "../../packages/crm-api/convex/helpers/sanityCatalogGraphPlan";
import {
	createSanityCatalogImportDryRunReport,
	createSanityCatalogImportManifest,
} from "../../packages/crm-api/convex/helpers/sanityCatalogImport";
import { checkAngelsRestCatalogBaseline } from "./migrations/angelsrest-catalog/catalogBaseline";
import { resolveCatalogDryRunOutputPath } from "./sanityCatalogDryRunSafety";
import { fetchPublishedSanityCatalogSource } from "./sanityCatalogSource";
import { readSanitySourceConfig } from "./sanitySourceConfig";

const REPOSITORY_ROOT = process.cwd();
const MIGRATION_DIRECTORY = resolve(REPOSITORY_ROOT, "scripts/cms/migrations/angelsrest-catalog");
const DISPLAY_MEDIA_MAP_PATH = resolve(MIGRATION_DIRECTORY, "sanity-catalog-image-asset-map.json");
const PRIVATE_ASSET_MAP_PATH = resolve(
	MIGRATION_DIRECTORY,
	"sanity-catalog-private-asset-map.json",
);
const DEFAULT_OUTPUT_PATH = "/tmp/angelsrest-sanity-catalog-graph-plan.json";
const SITE_URL = "angelsrest.online";
const SANITY_ASSET_REF_PATTERN =
	/^(image-[0-9a-f]{40}-[1-9]\d*x[1-9]\d*-(jpg|png|webp)|file-[0-9a-f]{40}-[a-z0-9]+)$/;
const CONVEX_ID_PATTERN = /^[a-z0-9]{20,64}$/;

function sortedRecord<T>(record: Record<string, T>) {
	return Object.fromEntries(
		Object.entries(record).sort(([left], [right]) => left.localeCompare(right)),
	) as Record<string, T>;
}

function parseArgs(args: string[]) {
	let output = DEFAULT_OUTPUT_PATH;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--output") {
			output = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	return { outputPath: resolveCatalogDryRunOutputPath(output) };
}

function asObject(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

function parseTargetRecord(value: unknown, label: string) {
	const record = asObject(value, label);
	const parsed: Record<string, string> = {};
	for (const [sourceRef, targetId] of Object.entries(record)) {
		if (!SANITY_ASSET_REF_PATTERN.test(sourceRef)) {
			throw new Error(`${label} has invalid source ref ${sourceRef}`);
		}
		if (typeof targetId !== "string" || !CONVEX_ID_PATTERN.test(targetId)) {
			throw new Error(`${label} has invalid target ID for ${sourceRef}`);
		}
		parsed[sourceRef] = targetId;
	}
	return sortedRecord(parsed);
}

async function readDisplayMediaTargets() {
	const raw = JSON.parse(await readFile(DISPLAY_MEDIA_MAP_PATH, "utf8")) as unknown;
	const record = parseTargetRecord(raw, "Catalog display-media map");
	return Object.entries(record).map(([sourceAssetRef, mediaAssetId]) => ({
		sourceAssetRef,
		mediaAssetId: mediaAssetId as Id<"mediaAssets">,
	}));
}

async function readPrivateAssetTargets() {
	const raw = asObject(
		JSON.parse(await readFile(PRIVATE_ASSET_MAP_PATH, "utf8")) as unknown,
		"Catalog private asset map",
	);
	if (raw.schemaVersion !== 1) throw new Error("Unsupported private asset map schemaVersion");
	if (raw.siteUrl !== SITE_URL) throw new Error("Private asset map siteUrl is invalid");
	if (
		typeof raw.receiptSetId !== "string" ||
		!raw.receiptSetId.startsWith("catalog-private-assets-v1:")
	) {
		throw new Error("Private asset map receiptSetId is invalid");
	}
	const targets = asObject(raw.targets, "Catalog private asset map targets");
	const printSources = parseTargetRecord(targets.printSources, "Catalog private print-source map");
	const paidFiles = parseTargetRecord(targets.paidFiles, "Catalog private paid-file map");
	return {
		receiptSetId: raw.receiptSetId,
		printSources: Object.entries(printSources).map(([sourceAssetRef, printSourceAssetId]) => ({
			sourceAssetRef,
			printSourceAssetId: printSourceAssetId as Id<"catalogPrintSourceAssets">,
		})),
		paidFiles: Object.entries(paidFiles).map(([sourceFileRef, digitalFileAssetId]) => ({
			sourceFileRef,
			digitalFileAssetId: digitalFileAssetId as Id<"catalogDigitalFileAssets">,
		})),
	};
}

function productSummary(plan: Awaited<ReturnType<typeof createSanityCatalogV2GraphPlan>>) {
	return plan.products.map((product) => ({
		productKey: product.productKey,
		sourceId: product.sourceId,
		sourceType: product.sourceType,
		sourceRevision: product.sourceRevision,
		productKind: product.draft.productKind,
		fulfillmentMode: product.draft.fulfillmentMode,
		slug: product.draft.slug ?? null,
		variants: product.draft.variants.length,
		webMedia: product.draft.webMedia.length,
		printSources: "printSources" in product.draft ? product.draft.printSources.length : 0,
		setMembers: "setMembers" in product.draft ? product.draft.setMembers.length : 0,
		hasPaidFile: "paidFile" in product.draft,
		graphChecksum: product.graphChecksum,
	}));
}

async function main() {
	const { outputPath } = parseArgs(process.argv.slice(2));
	const { projectId, dataset } = await readSanitySourceConfig(REPOSITORY_ROOT);
	const client = createClient({
		projectId,
		dataset,
		apiVersion: "2024-01-01",
		useCdn: false,
	});
	const [source, webMedia, privateTargets] = await Promise.all([
		fetchPublishedSanityCatalogSource(client),
		readDisplayMediaTargets(),
		readPrivateAssetTargets(),
	]);
	const manifest = createSanityCatalogImportManifest(source);
	const dryRun = createSanityCatalogImportDryRunReport(manifest);
	const baseline = checkAngelsRestCatalogBaseline(dryRun);
	if (baseline.status === "drifted" || dryRun.draftImport.status === "blocked") {
		throw new Error("Catalog source is not eligible for graph planning");
	}
	const targets: SanityCatalogV2TargetIdMaps = {
		webMedia,
		printSources: privateTargets.printSources,
		paidFiles: privateTargets.paidFiles,
	};
	const plan = await createSanityCatalogV2GraphPlan(manifest, targets);
	const output = {
		generatedAt: new Date().toISOString(),
		source: {
			projectId,
			dataset,
			perspective: "published",
		},
		baseline,
		readiness: {
			draftImport: dryRun.draftImport.status,
			publicationRemediation: dryRun.publicationRemediation.status,
		},
		counts: {
			products: plan.products.length,
			webMediaTargets: plan.assetMappings.webMedia.length,
			printSourceTargets: plan.assetMappings.printSources.length,
			paidFileTargets: plan.assetMappings.paidFiles.length,
			normalizedVariants: dryRun.counts.normalizedVariants,
			mediaPlacements: dryRun.counts.mediaPlacements,
			printSourcePlacements: dryRun.counts.printSourcePlacements,
			printSetMembers: dryRun.counts.printSetMembers,
		},
		evidence: {
			privateReceiptSetId: privateTargets.receiptSetId,
			graphPlanChecksum: plan.graphPlanChecksum,
		},
		products: productSummary(plan),
		plan,
	};
	await rm(outputPath, { force: true });
	await writeFile(outputPath, `${JSON.stringify(output, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	console.log(
		`Wrote Sanity catalog graph plan to ${outputPath}: ${plan.products.length} products; ${plan.assetMappings.webMedia.length} web media; ${plan.assetMappings.printSources.length} print sources; ${plan.assetMappings.paidFiles.length} paid files; checksum ${plan.graphPlanChecksum}`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
