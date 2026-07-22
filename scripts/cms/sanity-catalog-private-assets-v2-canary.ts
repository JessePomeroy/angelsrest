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
	clearV2CanaryFailureArtifactAfterSuccess,
	createV2CanaryFailureArtifact,
	executeV2CanaryStateMachine,
	loadV2CanarySelection,
	parseV2CanaryOptions,
	postV2CanaryWorkerReceipt,
	readV2CanaryConvexSelectorFile,
	readV2CanarySecretFile,
	resetV2CanaryArtifactDirectory,
	runV2CanaryCatalogStateValidation,
	runV2CanaryCatalogTransport,
	runV2CanaryConvexFunction,
	V2_CANARY_ARTIFACT_WRITE_FAILURE_STDERR,
	V2_CANARY_CONFIRMATION,
	V2_CANARY_FAILURE_ARTIFACT_PATH,
	V2_CANARY_FAILURE_STDERR,
	V2_CANARY_REPORT_PATH,
	type V2CanaryPhase,
	writeV2CanaryFailureArtifact,
} from "./sanityCatalogPrivateAssetV2Canary";
import { fetchPublishedSanityCatalogSource } from "./sanityCatalogSource";

const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const TARGET_JOURNAL_PATH = resolve(
	REPOSITORY_ROOT,
	"scripts/cms/migrations/angelsrest-catalog/sanity-catalog-private-asset-map.json",
);
const SANITY_PROJECT_ID = "n7rvza4g";
const SANITY_DATASET = "production";
const PNG_ASSET_ID = "image-4eb6f607de53cc329dafa75645ce38b96459d010-6935x4623-png";
const COMMAND_ARGS = process.argv.slice(2);
const EXECUTION_REQUESTED = COMMAND_ARGS.includes("--execute");
let executionPhase: V2CanaryPhase = "preflight";

const sanityClient = createClient({
	projectId: SANITY_PROJECT_ID,
	dataset: SANITY_DATASET,
	apiVersion: "2024-01-01",
	useCdn: false,
	perspective: "published",
});

async function readPublishedPlan() {
	const [source, png] = await runV2CanaryCatalogTransport(
		async () =>
			await Promise.all([
				fetchPublishedSanityCatalogSource(sanityClient),
				sanityClient.fetch<{
					size?: number;
					mimeType?: string;
					metadata?: { dimensions?: { width?: number; height?: number } };
				} | null>("*[_id == $id][0]{size,mimeType,metadata{dimensions{width,height}}}", {
					id: PNG_ASSET_ID,
				}),
			]),
	);
	return await runV2CanaryCatalogStateValidation(async () => {
		const manifest = createSanityCatalogImportManifest(source);
		const report = createSanityCatalogImportDryRunReport(manifest);
		const baseline = checkAngelsRestCatalogBaseline(report);
		if (baseline.status !== "matched" || report.draftImport.status === "blocked") {
			throw new Error("Published Sanity catalog no longer matches the reviewed baseline");
		}
		if (
			png?.mimeType !== "image/png" ||
			png.size !== 55_009_177 ||
			png.metadata?.dimensions?.width !== 6_935 ||
			png.metadata.dimensions.height !== 4_623
		) {
			throw new Error("Published oversized PNG metadata differs from the recorded baseline");
		}
		const journal = JSON.parse(await readFile(TARGET_JOURNAL_PATH, "utf8")) as unknown;
		const selection = loadV2CanarySelection(
			journal,
			report.requiredPrintSourceImageRefs,
			report.requiredSourceFileRefs,
		);
		return { manifest: JSON.stringify(manifest), selection };
	});
}

async function writeReport(value: unknown) {
	await writeFile(V2_CANARY_REPORT_PATH, `${JSON.stringify(value, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
}

async function main() {
	if (EXECUTION_REQUESTED) await resetV2CanaryArtifactDirectory();
	const options = parseV2CanaryOptions(COMMAND_ARGS);
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
		onPhase: (phase) => {
			executionPhase = phase;
		},
		dependencies: {
			snapshot: async () =>
				await runV2CanaryConvexFunction({
					repositoryRoot: REPOSITORY_ROOT,
					functionName: "catalogPrivateAssets:getV2CanarySnapshot",
				}),
			backfill: async () =>
				await runV2CanaryConvexFunction({
					repositoryRoot: REPOSITORY_ROOT,
					functionName: "catalogPrivateAssets:backfillTargetAuthorities",
				}),
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
	await clearV2CanaryFailureArtifactAfterSuccess();
	console.log(
		`Verified the three-object schema-2 canary and exact replays. Sanitized report: ${V2_CANARY_REPORT_PATH}`,
	);
}

main().catch(async (error) => {
	process.exitCode = 1;
	if (!EXECUTION_REQUESTED) {
		console.error("V2 canary failed.");
		return;
	}
	try {
		await writeV2CanaryFailureArtifact(
			V2_CANARY_FAILURE_ARTIFACT_PATH,
			createV2CanaryFailureArtifact(error, executionPhase),
		);
		console.error(V2_CANARY_FAILURE_STDERR);
	} catch {
		console.error(V2_CANARY_ARTIFACT_WRITE_FAILURE_STDERR);
	}
});
