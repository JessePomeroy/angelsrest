import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createClient } from "@sanity/client";
import {
	createSanityCatalogImportDryRunReport,
	createSanityCatalogImportManifest,
} from "../../packages/crm-api/convex/helpers/sanityCatalogImport";
import { checkAngelsRestCatalogBaseline } from "./migrations/angelsrest-catalog/catalogBaseline";
import {
	clearV2CanaryReportForExecution,
	executeV2CanaryStateMachine,
	loadV2CanarySelection,
	parseV2CanaryOptions,
	postV2CanaryWorkerReceipt,
	readV2CanaryConvexSelectorFile,
	readV2CanarySecretFile,
	runV2CanaryConvexFunction,
	V2_CANARY_CONFIRMATION,
} from "./sanityCatalogPrivateAssetV2Canary";
import { fetchPublishedSanityCatalogSource } from "./sanityCatalogSource";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TARGET_JOURNAL_PATH = resolve(
	REPOSITORY_ROOT,
	"scripts/cms/migrations/angelsrest-catalog/sanity-catalog-private-asset-map.json",
);
const REPORT_PATH = "/tmp/angelsrest-private-catalog-v2-canary-report.json";
const SANITY_PROJECT_ID = "n7rvza4g";
const SANITY_DATASET = "production";
const PNG_ASSET_ID = "image-4eb6f607de53cc329dafa75645ce38b96459d010-6935x4623-png";

const sanityClient = createClient({
	projectId: SANITY_PROJECT_ID,
	dataset: SANITY_DATASET,
	apiVersion: "2024-01-01",
	useCdn: false,
	perspective: "published",
});

async function readPublishedPlan() {
	const [source, png] = await Promise.all([
		fetchPublishedSanityCatalogSource(sanityClient),
		sanityClient.fetch<{
			size?: number;
			mimeType?: string;
			metadata?: { dimensions?: { width?: number; height?: number } };
		} | null>("*[_id == $id][0]{size,mimeType,metadata{dimensions{width,height}}}", {
			id: PNG_ASSET_ID,
		}),
	]);
	const manifest = createSanityCatalogImportManifest(source);
	const report = createSanityCatalogImportDryRunReport(manifest);
	const baseline = checkAngelsRestCatalogBaseline(report);
	if (baseline.status !== "matched" || report.draftImport.status === "blocked") {
		throw new Error("Published Sanity catalog no longer matches the reviewed 33-product baseline");
	}
	if (
		png?.mimeType !== "image/png" ||
		png.size !== 55_009_177 ||
		png.metadata?.dimensions?.width !== 6_935 ||
		png.metadata.dimensions.height !== 4_623
	)
		throw new Error("Published oversized PNG metadata differs from the recorded baseline");
	const journal = JSON.parse(await readFile(TARGET_JOURNAL_PATH, "utf8")) as unknown;
	const selection = loadV2CanarySelection(
		journal,
		report.requiredPrintSourceImageRefs,
		report.requiredSourceFileRefs,
	);
	return { manifest: JSON.stringify(manifest), selection };
}

function parseBackfill(value: unknown) {
	if (
		!value ||
		typeof value !== "object" ||
		Array.isArray(value) ||
		Object.keys(value).sort().join(",") !== "replayed,targetCount" ||
		typeof (value as { replayed?: unknown }).replayed !== "boolean" ||
		(value as { targetCount?: unknown }).targetCount !== 12
	)
		throw new Error("Convex authority backfill returned malformed output");
	return value as { replayed: boolean; targetCount: 12 };
}

async function writeReport(value: unknown) {
	await writeFile(REPORT_PATH, `${JSON.stringify(value, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
}

async function main() {
	const args = process.argv.slice(2);
	await clearV2CanaryReportForExecution(args, REPORT_PATH);
	const options = parseV2CanaryOptions(args);
	const plan = await readPublishedPlan();
	if (!options.execute) {
		console.log(
			"Plan ready: 3 fixed objects (JPEG, oversized PNG, paid ZIP); no credentials, Convex, Worker, object bytes, or report were accessed.",
		);
		console.log(
			`Execute with --execute --confirm "${V2_CANARY_CONFIRMATION}" --tenant-secret-file <0600-file> --inspection-secret-file <different-0600-file> --convex-env-file <selector-only-file>`,
		);
		return;
	}

	const tenantSecretFile = options.tenantSecretFile as string;
	const inspectionSecretFile = options.inspectionSecretFile as string;
	const convexEnvFile = options.convexEnvFile as string;
	const [tenantSecret, inspectionSecret] = await Promise.all([
		readV2CanarySecretFile(tenantSecretFile, "Tenant credential file"),
		readV2CanarySecretFile(inspectionSecretFile, "Inspection credential file"),
		readV2CanaryConvexSelectorFile(convexEnvFile),
	]);
	if (tenantSecret === inspectionSecret)
		throw new Error("Tenant and inspection credentials must differ");
	const privateObjectKeys = plan.selection.map((item) => item.privateObjectKey);
	const report = await executeV2CanaryStateMachine({
		preManifest: plan.manifest,
		tenantSecret,
		inspectionSecret,
		privateObjectKeys,
		dependencies: {
			snapshot: async () =>
				await runV2CanaryConvexFunction({
					repositoryRoot: REPOSITORY_ROOT,
					functionName: "catalogPrivateAssets:getV2CanarySnapshot",
				}),
			backfill: async () =>
				parseBackfill(
					await runV2CanaryConvexFunction({
						repositoryRoot: REPOSITORY_ROOT,
						functionName: "catalogPrivateAssets:backfillTargetAuthorities",
					}),
				),
			postWorker: async (path, secret, keys, expectedReceiptSetId) =>
				await postV2CanaryWorkerReceipt({
					path,
					secret,
					privateObjectKeys: keys,
					expectedReceiptSetId,
				}),
			readPublishedManifest: async () => (await readPublishedPlan()).manifest,
		},
	});
	await writeReport(report);
	console.log(
		`Verified the three-object schema-2 canary and exact replays. Sanitized report: ${REPORT_PATH}`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : "V2 canary failed");
	process.exitCode = 1;
});
