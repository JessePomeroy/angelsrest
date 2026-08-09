import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
	claimProviderInvestigationAttempt,
	observeProviderMatch,
	type ProviderConfiguration,
	type ProviderInvestigationResult,
	type ProviderInvestigationTarget,
	parseProviderInvestigationTarget,
	productionProviderModeIsSafe,
	runProviderInvestigation,
} from "./providerInvestigation";

const OPERATION_ID = "angels_rest_print_provider_investigation_v1_20260809";
const EXPECTED_CONVEX_URL = "https://loyal-swan-967.convex.cloud";
const EXPECTED_CONVEX_DEPLOYMENT = "loyal-swan-967";
const ATTEMPT_DIRECTORY = join(
	homedir(),
	".local/state/angelsrest-r2-print-provider-investigation-live",
);
const execFileAsync = promisify(execFile);
const convexBinary = fileURLToPath(new URL("../../node_modules/.bin/convex", import.meta.url));
const crmDirectory = fileURLToPath(new URL("../../packages/crm-api", import.meta.url));

function configurationError(): ProviderInvestigationResult {
	return "provider_investigation:configuration_error";
}

async function getTarget(): Promise<ProviderInvestigationTarget> {
	const { stdout } = await execFileAsync(
		convexBinary,
		[
			"run",
			"orderReset:providerInvestigationTarget",
			"{}",
			"--deployment",
			EXPECTED_CONVEX_DEPLOYMENT,
			"--typecheck",
			"disable",
			"--codegen",
			"disable",
		],
		{
			cwd: crmDirectory,
			timeout: 30_000,
			maxBuffer: 16 * 1024,
			env: {
				HOME: process.env.HOME,
				PATH: process.env.PATH,
				XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME,
				XDG_CACHE_HOME: process.env.XDG_CACHE_HOME,
				NO_COLOR: "1",
			},
		},
	);
	return parseProviderInvestigationTarget(stdout.trim());
}

async function main(): Promise<ProviderInvestigationResult> {
	const convexUrl = process.env.PUBLIC_CONVEX_URL;
	const apiKey = process.env.LUMAPRINTS_API_KEY;
	const apiSecret = process.env.LUMAPRINTS_API_SECRET;
	const storeId = process.env.LUMAPRINTS_STORE_ID;
	if (
		process.env.ORDER_RESET_PROVIDER_INVESTIGATION_ID !== OPERATION_ID ||
		process.env.ORDER_PRODUCERS_STATE !== "closed" ||
		convexUrl !== EXPECTED_CONVEX_URL ||
		!productionProviderModeIsSafe(process.env.LUMAPRINTS_USE_SANDBOX) ||
		!apiKey ||
		!apiSecret ||
		!storeId ||
		!/^\d+$/.test(storeId)
	)
		return configurationError();
	const numericStoreId = Number(storeId);
	if (!Number.isSafeInteger(numericStoreId) || numericStoreId <= 0) return configurationError();

	const configuration: ProviderConfiguration = {
		apiKey,
		apiSecret,
		storeId: numericStoreId,
		baseUrl: "https://us.api.lumaprints.com",
	};
	return await runProviderInvestigation({
		getTarget,
		observeMatch: async (externalId) => await observeProviderMatch(externalId, configuration),
	});
}

process.umask(0o077);
const result = (await claimProviderInvestigationAttempt(ATTEMPT_DIRECTORY))
	? await main().catch(configurationError)
	: "provider_investigation:operation_unavailable";
process.stdout.write(`${result}\n`);
