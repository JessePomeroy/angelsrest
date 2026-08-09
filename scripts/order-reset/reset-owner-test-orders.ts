import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	applyOwnerTestOrderReset,
	runOwnerTestOrderReset,
	verifyOwnerTestOrderReset,
} from "./ownerTestOrderReset";
import { claimProtectedOperationAttempt } from "./providerInvestigation";

const OPERATION_ID = "angels_rest_owner_test_order_reset_v2_20260809";
const EXPECTED_CONVEX_URL = "https://loyal-swan-967.convex.cloud";
const EXPECTED_CONVEX_DEPLOYMENT = "loyal-swan-967";
const ATTEMPT_DIRECTORY = join(homedir(), ".local/state/angelsrest-r2-owner-test-order-reset-live");
const execFileAsync = promisify(execFile);
const convexBinary = fileURLToPath(new URL("../../node_modules/.bin/convex", import.meta.url));
const crmDirectory = fileURLToPath(new URL("../../packages/crm-api", import.meta.url));

async function applyReset() {
	return await applyOwnerTestOrderReset({
		execute: async (file, args, options) => await execFileAsync(file, args, options),
		convexBinary,
		crmDirectory,
		deployment: EXPECTED_CONVEX_DEPLOYMENT,
		environment: process.env,
	});
}

async function verifyReset() {
	return await verifyOwnerTestOrderReset({
		execute: async (file, args, options) => await execFileAsync(file, args, options),
		convexBinary,
		crmDirectory,
		deployment: EXPECTED_CONVEX_DEPLOYMENT,
		environment: process.env,
	});
}

process.umask(0o077);
const result = await runOwnerTestOrderReset({
	claimAttempt: async () =>
		await claimProtectedOperationAttempt(
			ATTEMPT_DIRECTORY,
			"production-owner-test-order-reset-attempted",
			"owner_test_order_reset_attempted\n",
		),
	applyReset,
	verifyReset,
	environment: process.env,
	operationId: OPERATION_ID,
	expectedConvexUrl: EXPECTED_CONVEX_URL,
});
process.stdout.write(`${result}\n`);
