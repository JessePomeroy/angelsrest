import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { claimProviderMultiInvestigationAttempt } from "./providerInvestigation";
import {
	readProviderMultiInvestigationTargets,
	runProviderMultiInvestigationCaller,
} from "./providerMultiInvestigationCaller";

const OPERATION_ID = "angels_rest_print_provider_multi_investigation_v1_20260809";
const EXPECTED_CONVEX_URL = "https://loyal-swan-967.convex.cloud";
const EXPECTED_CONVEX_DEPLOYMENT = "loyal-swan-967";
const ATTEMPT_DIRECTORY = join(
	homedir(),
	".local/state/angelsrest-r2-print-provider-multi-investigation-live",
);
const execute = promisify(execFile);
const convexBinary = fileURLToPath(new URL("../../node_modules/.bin/convex", import.meta.url));
const crmDirectory = fileURLToPath(new URL("../../packages/crm-api", import.meta.url));

process.umask(0o077);
const result = await runProviderMultiInvestigationCaller({
	claimAttempt: async () => await claimProviderMultiInvestigationAttempt(ATTEMPT_DIRECTORY),
	readTargets: async () =>
		await readProviderMultiInvestigationTargets({
			execute,
			convexBinary,
			crmDirectory,
			deployment: EXPECTED_CONVEX_DEPLOYMENT,
			environment: process.env,
		}),
	environment: process.env,
	operationId: OPERATION_ID,
	expectedConvexUrl: EXPECTED_CONVEX_URL,
});
process.stdout.write(`${result}\n`);
