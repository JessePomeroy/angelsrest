import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	assertSafeConvexProductionEnvFile,
	sanitizedConvexCliEnvironment,
} from "./sanityBlogMediaVerification";
import {
	parseSanityBlogReconciliationCliOptions,
	parseSanityBlogReconciliationResult,
	requireSanityBlogReconciliationExecutionConfirmation,
} from "./sanityBlogReconciliationOperator";
import { parseSanityBlogReconciliationArtifact } from "./sanityBlogReconciliationPlan";

const execFileAsync = promisify(execFile);
const REPOSITORY_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const CONVEX_ENV_FILE_PATH = resolve(REPOSITORY_ROOT, ".env.local");

async function runInternal(plan: unknown, digest: string) {
	const envFile = await readFile(CONVEX_ENV_FILE_PATH, "utf8");
	assertSafeConvexProductionEnvFile(envFile);
	const convexCli = resolve(REPOSITORY_ROOT, "node_modules/convex/bin/main.js");
	const { stdout, stderr } = await execFileAsync(
		process.execPath,
		[
			convexCli,
			"run",
			"sanityBlogReconciliation:reconcileDrafts",
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
	if (stderr.trim()) throw new Error("Convex CLI reported an unexpected warning");
	return JSON.parse(stdout) as unknown;
}

async function main() {
	const options = parseSanityBlogReconciliationCliOptions(process.argv.slice(2));
	const artifact = await parseSanityBlogReconciliationArtifact(
		JSON.parse(await readFile(resolve(options.artifactPath), "utf8")) as unknown,
	);
	if (!options.execute) {
		console.log(artifact.digest);
		return;
	}
	requireSanityBlogReconciliationExecutionConfirmation(options, artifact.digest);
	const first = parseSanityBlogReconciliationResult(
		await runInternal(artifact.plan, artifact.digest),
		artifact.plan,
		artifact.digest,
	);
	const replay = parseSanityBlogReconciliationResult(
		await runInternal(artifact.plan, artifact.digest),
		artifact.plan,
		artifact.digest,
	);
	if (
		replay.status !== "identical-replay" ||
		JSON.stringify(first.documents) !== JSON.stringify(replay.documents)
	)
		throw new Error("Immediate reconciliation replay was not exact and zero-write");
	console.log(`${first.status}:${artifact.digest}`);
}

void main().catch((error) => {
	console.error(error instanceof Error ? error.message : "Blog reconciliation failed");
	process.exitCode = 1;
});
