import { execFile } from "node:child_process";
import { readFile, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { createClient } from "@sanity/client";
import {
	ANGELS_REST_BLOG_MEDIA_EXPECTATIONS,
	assertSafeConvexProductionEnvFile,
	collectPublishedSanityBlogImageAssetRefs,
	parseConvexImportTargetProjections,
	parseSanityBlogImageAssetJournal,
	parseSanityBlogMediaTransferReceipts,
	probeSanityBlogMediaDerivatives,
	SANITY_BLOG_MEDIA_TRANSFER_RECEIPTS_FILENAME,
	SANITY_BLOG_MEDIA_VERIFICATION_REPORT_PATH,
	sanitizedConvexCliEnvironment,
	verifySanityBlogMediaTargets,
} from "./sanityBlogMediaVerification";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const MIGRATION_DIRECTORY = resolve(REPOSITORY_ROOT, "scripts/cms/migrations/angelsrest-blog");
const DEFAULT_IMAGE_ASSET_MAP_PATH = resolve(
	MIGRATION_DIRECTORY,
	"sanity-blog-image-asset-map.json",
);
const DEFAULT_TRANSFER_RECEIPTS_PATH = resolve(
	MIGRATION_DIRECTORY,
	SANITY_BLOG_MEDIA_TRANSFER_RECEIPTS_FILENAME,
);
const CONVEX_ENV_FILE_PATH = resolve(REPOSITORY_ROOT, ".env.local");

type CliOptions = {
	imageAssetMapPath: string;
	transferReceiptsPath: string;
};

function cliOptions(args: string[]): CliOptions {
	const options: CliOptions = {
		imageAssetMapPath: DEFAULT_IMAGE_ASSET_MAP_PATH,
		transferReceiptsPath: DEFAULT_TRANSFER_RECEIPTS_PATH,
	};
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		const value = args[index + 1];
		if (arg === "--image-asset-map" || arg === "--transfer-receipts") {
			if (!value) throw new Error(`${arg} requires a value`);
			if (arg === "--image-asset-map") options.imageAssetMapPath = resolve(value);
			if (arg === "--transfer-receipts") options.transferReceiptsPath = resolve(value);
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	return options;
}

async function readJson(path: string) {
	return JSON.parse(await readFile(path, "utf8")) as unknown;
}

function publishedSourceQuery() {
	return `{
		"authors": *[_type == "author"] | order(_id asc) {
			image { asset }
		},
		"posts": *[_type == "post"] | order(_id asc) {
			mainImage { asset },
			body[] { _type, asset }
		}
	}`;
}

async function fetchPublishedSourceAssetRefs() {
	const { projectId, dataset } = ANGELS_REST_BLOG_MEDIA_EXPECTATIONS;
	const client = createClient({
		projectId,
		dataset,
		apiVersion: "2024-01-01",
		useCdn: false,
	});
	try {
		const source = await client.fetch<unknown>(
			publishedSourceQuery(),
			{},
			{ perspective: "published" },
		);
		return collectPublishedSanityBlogImageAssetRefs(source);
	} catch {
		throw new Error("Published Sanity Blog source read failed");
	}
}

async function runProductionConvexVerification(ids: string[]) {
	if (ids.length === 0) return [];
	assertSafeConvexProductionEnvFile(await readFile(CONVEX_ENV_FILE_PATH, "utf8"));
	const convexCli = resolve(REPOSITORY_ROOT, "node_modules/convex/bin/main.js");
	const args = JSON.stringify({
		expectedSiteUrl: ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.siteUrl,
		ids,
	});
	try {
		const { stdout, stderr } = await execFileAsync(
			process.execPath,
			[
				convexCli,
				"run",
				"mediaAssets:verifyImportTargets",
				args,
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
				maxBuffer: 2 * 1024 * 1024,
				windowsHide: true,
			},
		);
		if (stderr.trim()) {
			throw new Error("Convex CLI reported an unexpected deployment-selection warning");
		}
		return parseConvexImportTargetProjections(JSON.parse(stdout) as unknown);
	} catch {
		throw new Error("Production Convex media target verification failed");
	}
}

async function writeReport(path: string, report: unknown) {
	if (path !== SANITY_BLOG_MEDIA_VERIFICATION_REPORT_PATH) {
		throw new Error("Sanitized verification reports use one fixed temporary path");
	}
	await rm(path, { force: true });
	await writeFile(
		path,
		`${JSON.stringify({ generatedAt: new Date().toISOString(), ...objectReport(report) }, null, 2)}\n`,
		{ flag: "wx", mode: 0o600 },
	);
}

function objectReport(value: unknown) {
	return typeof value === "object" && value !== null && !Array.isArray(value)
		? value
		: {
				status: "blocked",
				issues: [
					{
						code: "verification-failed",
						message: "Verification failed before a report could be produced",
					},
				],
			};
}

async function run(options: CliOptions) {
	const [journalValue, receiptValue, sourceAssetRefs] = await Promise.all([
		readJson(options.imageAssetMapPath),
		readJson(options.transferReceiptsPath),
		fetchPublishedSourceAssetRefs(),
	]);
	const journal = parseSanityBlogImageAssetJournal(journalValue);
	const receiptFile = parseSanityBlogMediaTransferReceipts(receiptValue);
	const ids = Object.values(journal).filter(Boolean);
	const duplicateIds = ids.filter((id, index) => ids.indexOf(id) !== index);
	if (duplicateIds.length > 0) {
		const report = verifySanityBlogMediaTargets({
			sourceAssetRefs,
			journal,
			receiptFile,
			convexTargets: [],
		});
		return report;
	}
	const convexTargets = await runProductionConvexVerification(ids);
	const verified = verifySanityBlogMediaTargets({
		sourceAssetRefs,
		journal,
		receiptFile,
		convexTargets,
	});
	return await probeSanityBlogMediaDerivatives(verified, {
		fetcher: fetch,
		mediaBaseUrl: ANGELS_REST_BLOG_MEDIA_EXPECTATIONS.mediaBaseUrl,
	});
}

async function main() {
	const outputPath = SANITY_BLOG_MEDIA_VERIFICATION_REPORT_PATH;
	try {
		const options = cliOptions(process.argv.slice(2));
		const report = await run(options);
		await writeReport(outputPath, report);
		console.log(
			`Wrote sanitized Sanity Blog media verification report to ${outputPath}: ${report.status} (${report.counts.registryVerifiedAssets}/${report.counts.mappedAssets} mapped assets registry-verified, ${report.counts.issues} issues)`,
		);
		if (report.status === "blocked") process.exitCode = 1;
	} catch (error) {
		const message =
			error instanceof Error &&
			!error.message.includes("Convex") &&
			!error.message.includes("Sanity")
				? error.message
				: "Verification failed at an external read boundary";
		const blocked = {
			status: "blocked",
			issues: [{ code: "verification-failed", message }],
		};
		await writeReport(outputPath, blocked);
		console.error(`Wrote blocked Sanity Blog media verification report to ${outputPath}`);
		process.exitCode = 1;
	}
}

void main().catch(() => {
	console.error("Sanity Blog media verification could not write its sanitized report");
	process.exitCode = 1;
});
