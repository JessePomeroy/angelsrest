import {
	observeProviderMatches,
	type ProviderConfiguration,
	type ProviderMultiInvestigationResult,
	parseProviderMultiInvestigationTargets,
	productionProviderModeIsSafe,
	runProviderMultiInvestigation,
} from "./providerInvestigation";

export const PROVIDER_MULTI_INVESTIGATION_FUNCTION =
	"orderReset:providerMultiInvestigationTargets" as const;

export function providerMultiInvestigationCliArguments(deployment: string) {
	return [
		"run",
		PROVIDER_MULTI_INVESTIGATION_FUNCTION,
		"{}",
		"--deployment",
		deployment,
		"--typecheck",
		"disable",
		"--codegen",
		"disable",
	] as const;
}

export function providerMultiInvestigationChildEnvironment(
	environment: Record<string, string | undefined>,
) {
	return {
		HOME: environment.HOME,
		PATH: environment.PATH,
		XDG_CONFIG_HOME: environment.XDG_CONFIG_HOME,
		XDG_CACHE_HOME: environment.XDG_CACHE_HOME,
		NO_COLOR: "1",
	};
}

interface ProviderMultiInvestigationExecutionOptions {
	cwd: string;
	timeout: number;
	maxBuffer: number;
	encoding: "utf8";
	env: Record<string, string | undefined>;
}

export async function readProviderMultiInvestigationTargets(dependencies: {
	execute: (
		file: string,
		args: string[],
		options: ProviderMultiInvestigationExecutionOptions,
	) => Promise<{ stdout: string }>;
	convexBinary: string;
	crmDirectory: string;
	deployment: string;
	environment: Record<string, string | undefined>;
}) {
	const { stdout } = await dependencies.execute(
		dependencies.convexBinary,
		[...providerMultiInvestigationCliArguments(dependencies.deployment)],
		{
			cwd: dependencies.crmDirectory,
			timeout: 30_000,
			maxBuffer: 32 * 1024,
			encoding: "utf8",
			env: providerMultiInvestigationChildEnvironment(dependencies.environment),
		},
	);
	return stdout.trim();
}

export function providerMultiInvestigationConfiguration(
	environment: Record<string, string | undefined>,
	operationId: string,
	expectedConvexUrl: string,
): ProviderConfiguration | null {
	const storeId = environment.LUMAPRINTS_STORE_ID;
	if (
		environment.ORDER_RESET_PROVIDER_MULTI_INVESTIGATION_ID !== operationId ||
		environment.ORDER_PRODUCERS_STATE !== "closed" ||
		environment.PUBLIC_CONVEX_URL !== expectedConvexUrl ||
		!productionProviderModeIsSafe(environment.LUMAPRINTS_USE_SANDBOX) ||
		!environment.LUMAPRINTS_API_KEY ||
		!environment.LUMAPRINTS_API_SECRET ||
		!storeId ||
		!/^\d+$/.test(storeId)
	)
		return null;
	const numericStoreId = Number(storeId);
	if (!Number.isSafeInteger(numericStoreId) || numericStoreId <= 0) return null;
	return {
		apiKey: environment.LUMAPRINTS_API_KEY,
		apiSecret: environment.LUMAPRINTS_API_SECRET,
		storeId: numericStoreId,
		baseUrl: "https://us.api.lumaprints.com",
	};
}

export async function runProviderMultiInvestigationCaller(dependencies: {
	claimAttempt: () => Promise<boolean>;
	readTargets: () => Promise<string>;
	environment: Record<string, string | undefined>;
	operationId: string;
	expectedConvexUrl: string;
	observeMatches?: typeof observeProviderMatches;
}): Promise<ProviderMultiInvestigationResult> {
	if (!(await dependencies.claimAttempt())) {
		return "provider_multi_investigation:operation_unavailable";
	}
	const configuration = providerMultiInvestigationConfiguration(
		dependencies.environment,
		dependencies.operationId,
		dependencies.expectedConvexUrl,
	);
	if (configuration === null) return "provider_multi_investigation:configuration_error";
	const observeMatches = dependencies.observeMatches ?? observeProviderMatches;
	return await runProviderMultiInvestigation({
		getTargets: async () =>
			parseProviderMultiInvestigationTargets(await dependencies.readTargets()),
		observeMatches: async (externalIds) => await observeMatches(externalIds, configuration),
	});
}
