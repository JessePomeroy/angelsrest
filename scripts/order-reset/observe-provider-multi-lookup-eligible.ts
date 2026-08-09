import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { claimProtectedOperationAttempt } from "./providerInvestigation";
import {
	readProviderMultiLookupObserverTargets,
	runProviderMultiLookupObserver,
} from "./providerMultiLookupObserver";

const OPERATION_ID = "angels_rest_provider_multi_lookup_observer_v1_20260809";
const EXPECTED_CONVEX_URL = "https://loyal-swan-967.convex.cloud";
const EXPECTED_CONVEX_DEPLOYMENT = "loyal-swan-967";
const ATTEMPT_DIRECTORY = join(
	homedir(),
	".local/state/angelsrest-r2-provider-multi-lookup-observer-live",
);
const execFileAsync = promisify(execFile);
const convexBinary = fileURLToPath(new URL("../../node_modules/.bin/convex", import.meta.url));
const crmDirectory = fileURLToPath(new URL("../../packages/crm-api", import.meta.url));

async function readTargets() {
	return await readProviderMultiLookupObserverTargets({
		execute: async (file, args, options) => await execFileAsync(file, args, options),
		convexBinary,
		crmDirectory,
		deployment: EXPECTED_CONVEX_DEPLOYMENT,
		environment: process.env,
	});
}

process.umask(0o077);
const result = await runProviderMultiLookupObserver({
	claimAttempt: async () =>
		await claimProtectedOperationAttempt(
			ATTEMPT_DIRECTORY,
			"production-multi-lookup-observer-attempted",
			"provider_multi_lookup_observer_attempted\n",
		),
	readTargets,
	environment: process.env,
	operationId: OPERATION_ID,
	expectedConvexUrl: EXPECTED_CONVEX_URL,
});
process.stdout.write(`${result}\n`);
