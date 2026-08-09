import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { claimProtectedOperationAttempt } from "./providerInvestigation";
import {
	readProviderMultiTargetConflictClassification,
	runProviderMultiTargetConflictClassifier,
} from "./providerMultiTargetConflictClassifier";

const OPERATION_ID = "angels_rest_provider_multi_target_conflict_classifier_v1_20260809";
const EXPECTED_CONVEX_URL = "https://loyal-swan-967.convex.cloud";
const EXPECTED_CONVEX_DEPLOYMENT = "loyal-swan-967";
const ATTEMPT_DIRECTORY = join(
	homedir(),
	".local/state/angelsrest-r2-provider-multi-target-conflict-classifier-live",
);
const execFileAsync = promisify(execFile);
const convexBinary = fileURLToPath(new URL("../../node_modules/.bin/convex", import.meta.url));
const crmDirectory = fileURLToPath(new URL("../../packages/crm-api", import.meta.url));

async function readClassification() {
	return await readProviderMultiTargetConflictClassification({
		execute: async (file, args, options) => await execFileAsync(file, args, options),
		convexBinary,
		crmDirectory,
		deployment: EXPECTED_CONVEX_DEPLOYMENT,
		environment: process.env,
	});
}

process.umask(0o077);
const result = await runProviderMultiTargetConflictClassifier({
	claimAttempt: async () =>
		await claimProtectedOperationAttempt(
			ATTEMPT_DIRECTORY,
			"production-multi-target-conflict-classifier-attempted",
			"provider_multi_target_classifier_attempted\n",
		),
	readClassification,
	environment: process.env,
	operationId: OPERATION_ID,
	expectedConvexUrl: EXPECTED_CONVEX_URL,
});
process.stdout.write(`${result}\n`);
