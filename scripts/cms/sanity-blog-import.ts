import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient } from "@sanity/client";
import {
	createSanityBlogImportDryRunReport,
	createSanityBlogImportManifest,
} from "../../packages/crm-api/convex/helpers/sanityBlogImport";
import {
	ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE,
	checksumSanityBlogImportPlan,
	createAngelsRestSanityBlogImportPlan,
	requireReleasedSanityBlogImportPlan,
	type SanityBlogImportPlan,
} from "../../packages/crm-api/convex/helpers/sanityBlogImportPlan";
import { parseSanityBlogImageAssetMap } from "./sanityBlogImportPrep";
import {
	assertSafeConvexProductionEnvFile,
	sanitizedConvexCliEnvironment,
} from "./sanityBlogMediaVerification";
import { fetchPublishedSanityBlogSource, readSanityBlogSourceConfig } from "./sanityBlogSource";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const IMAGE_ASSET_MAP_PATH = resolve(
	REPOSITORY_ROOT,
	"scripts/cms/migrations/angelsrest-blog/sanity-blog-image-asset-map.json",
);
const CONVEX_ENV_FILE_PATH = resolve(REPOSITORY_ROOT, ".env.local");
const REPORT_PATH = "/tmp/angelsrest-sanity-blog-import-execution.json";
const CONFIRMATION = "import CMS-4.4p unpublished Angels Rest Blog drafts";

type CliOptions = { execute: boolean; confirmation?: string };

type ImportResult = {
	status: "imported" | "identical-replay";
	digest: string;
	documents: Array<{
		kind: "author" | "category" | "post";
		documentKey: string;
		documentId: string;
		revisionId: string;
	}>;
};

let executionCheckpoint: { summary: Record<string, unknown>; first: ImportResult } | undefined;

function cliOptions(args: string[]): CliOptions {
	const options: CliOptions = { execute: false };
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--execute") {
			options.execute = true;
			continue;
		}
		if (arg === "--confirm") {
			options.confirmation = args[index + 1];
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	if (options.execute && options.confirmation !== CONFIRMATION) {
		throw new Error(`Production execution requires --confirm "${CONFIRMATION}"`);
	}
	if (!options.execute && options.confirmation !== undefined) {
		throw new Error("--confirm is valid only with --execute");
	}
	return options;
}

function parseImportResult(value: unknown): ImportResult {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("Convex import returned an invalid result");
	}
	const candidate = value as Partial<ImportResult>;
	if (
		(candidate.status !== "imported" && candidate.status !== "identical-replay") ||
		candidate.digest !== ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.expectedDigest ||
		!Array.isArray(candidate.documents) ||
		candidate.documents.length !== 6
	)
		throw new Error("Convex import returned an invalid result");
	const expectedKinds = new Map<string, ImportResult["documents"][number]["kind"]>([
		...ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.documentKeys.authors.map(
			(documentKey) => [documentKey, "author" as const] as const,
		),
		...ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.documentKeys.categories.map(
			(documentKey) => [documentKey, "category" as const] as const,
		),
		...ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.documentKeys.posts.map(
			(documentKey) => [documentKey, "post" as const] as const,
		),
	]);
	for (const document of candidate.documents) {
		if (
			typeof document !== "object" ||
			document === null ||
			expectedKinds.get(document.documentKey) !== document.kind ||
			typeof document.documentId !== "string" ||
			typeof document.revisionId !== "string"
		)
			throw new Error("Convex import returned an invalid document result");
	}
	if (new Set(candidate.documents.map((document) => document.documentKey)).size !== 6) {
		throw new Error("Convex import result document keys are not unique");
	}
	if (
		new Set(candidate.documents.map((document) => document.documentId)).size !== 6 ||
		new Set(candidate.documents.map((document) => document.revisionId)).size !== 6
	) {
		throw new Error("Convex import result identities are not unique");
	}
	return candidate as ImportResult;
}

async function runProductionImport(plan: SanityBlogImportPlan, digest: string) {
	const envFile = await readFile(CONVEX_ENV_FILE_PATH, "utf8");
	assertSafeConvexProductionEnvFile(envFile);
	const convexCli = resolve(REPOSITORY_ROOT, "node_modules/convex/bin/main.js");
	const { stdout, stderr } = await execFileAsync(
		process.execPath,
		[
			convexCli,
			"run",
			"blogContent:importSanityBlogDrafts",
			JSON.stringify({ plan, digest }),
			"--prod",
			"--env-file",
			CONVEX_ENV_FILE_PATH,
			"--codegen",
			"disable",
			"--typecheck",
			"disable",
		],
		{
			cwd: REPOSITORY_ROOT,
			env: sanitizedConvexCliEnvironment(process.env),
			maxBuffer: 8 * 1024 * 1024,
			windowsHide: true,
		},
	);
	if (stderr.trim()) {
		throw new Error("Convex CLI reported an unexpected deployment-selection warning");
	}
	return parseImportResult(JSON.parse(stdout) as unknown);
}

async function writeReport(report: Record<string, unknown>) {
	await rm(REPORT_PATH, { force: true });
	await writeFile(
		REPORT_PATH,
		`${JSON.stringify({ generatedAt: new Date().toISOString(), ...report }, null, 2)}\n`,
		{ flag: "wx", mode: 0o600 },
	);
}

async function buildReleasedPlan() {
	const { projectId, dataset } = await readSanityBlogSourceConfig(REPOSITORY_ROOT);
	if (
		projectId !== ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.source.projectId ||
		dataset !== ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.source.dataset
	)
		throw new Error("Configured Sanity source does not match the released import source");
	const imageAssetIds = parseSanityBlogImageAssetMap(
		JSON.parse(await readFile(IMAGE_ASSET_MAP_PATH, "utf8")) as unknown,
	);
	const client = createClient({
		projectId,
		dataset,
		apiVersion: "2024-01-01",
		useCdn: false,
	});
	const source = await fetchPublishedSanityBlogSource(client);
	const manifest = createSanityBlogImportManifest(source, { imageAssetIds });
	const readiness = createSanityBlogImportDryRunReport(manifest);
	const plan = createAngelsRestSanityBlogImportPlan(manifest, imageAssetIds);
	const digest = await checksumSanityBlogImportPlan(plan);
	if (digest !== ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE.expectedDigest) {
		throw new Error(
			`Published Sanity Blog import plan changed from the released digest (candidate ${digest})`,
		);
	}
	await requireReleasedSanityBlogImportPlan(plan, digest, ANGELS_REST_SANITY_BLOG_IMPORT_RELEASE);
	return { plan, digest, readiness };
}

async function main() {
	const options = cliOptions(process.argv.slice(2));
	const { plan, digest, readiness } = await buildReleasedPlan();
	const summary = {
		migrationId: plan.migrationId,
		siteUrl: plan.siteUrl,
		digest,
		counts: {
			authors: plan.authors.length,
			categories: plan.categories.length,
			posts: plan.posts.length,
			assets: plan.assetMappings.length,
		},
		draftImport: readiness.draftImport,
		publication: readiness.publication,
	};
	if (!options.execute) {
		await writeReport({ status: "ready", mode: "plan", ...summary });
		console.log(
			`CMS-4.4p plan is ready: 1 Author, 1 Category, 4 Posts, 21 media assets; wrote ${REPORT_PATH}`,
		);
		return;
	}

	const first = await runProductionImport(plan, digest);
	executionCheckpoint = { summary, first };
	await writeReport({ status: "replay-pending", mode: "execute", ...summary, first });
	const replay = await runProductionImport(plan, digest);
	if (replay.status !== "identical-replay") {
		throw new Error("The immediate import replay was not reported as zero-write identical state");
	}
	if (JSON.stringify(first.documents) !== JSON.stringify(replay.documents)) {
		throw new Error("The immediate import replay returned changed document identities");
	}
	await writeReport({ status: "accepted", mode: "execute", ...summary, first, replay });
	executionCheckpoint = undefined;
	console.log(
		`CMS-4.4p production import accepted (${first.status}; replay ${replay.status}); wrote ${REPORT_PATH}`,
	);
}

void main().catch(async (error) => {
	const message = error instanceof Error ? error.message : "Blog import failed";
	try {
		await writeReport(
			executionCheckpoint
				? {
						status: "replay-unconfirmed",
						mode: "execute",
						...executionCheckpoint.summary,
						first: executionCheckpoint.first,
						issues: [
							{
								code: "replay-unconfirmed",
								message:
									"The first mutation returned successfully, but its identical replay was not confirmed",
							},
						],
					}
				: { status: "blocked", issues: [{ code: "import-failed", message }] },
		);
	} catch {
		// Preserve the primary failure when the sanitized report cannot be written.
	}
	console.error(message);
	process.exitCode = 1;
});
