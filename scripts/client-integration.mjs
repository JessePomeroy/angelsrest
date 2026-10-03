import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { assertContract } from "./client-integration/contract.mjs";
import { installWorkflow } from "./client-integration/install.mjs";
import { checkReadiness, sourceFingerprint } from "./client-integration/inventory.mjs";
import { createSetupPlan } from "./client-integration/plan.mjs";
import {
	checkCandidate,
	checkConvexRegistry,
	checkPreflight,
	loadRegistryValidator,
} from "./client-integration/preflight.mjs";
import { prepareClientSetup } from "./client-integration/prepare.mjs";

const usage =
	"Usage: node scripts/client-integration.mjs check|plan|preflight|candidate|convex-registry <environment> OR prepare <environment> <reviewed-plan.json> OR init|resume <repository> <contract.json>. Registry JSON uses protected stdin.";

async function readProtectedInput(stream) {
	if (stream.isTTY) throw new Error("Protected input is required.");
	const chunks = [];
	let size = 0;
	for await (const chunk of stream) {
		const bytes = Buffer.from(chunk);
		size += bytes.length;
		if (size > 262_144) throw new Error("Input too large.");
		chunks.push(bytes);
	}
	return Buffer.concat(chunks).toString("utf8");
}

/** Explicitly select configured inputs; never serialize the process environment. */
function configuredInputs(contract) {
	const names = new Set([
		"PUBLIC_SITE_DOMAIN",
		"PUBLIC_CONVEX_URL",
		"PUBLIC_CONVEX_SITE_URL",
		"PUBLIC_CMS_MEDIA_BASE_URL",
		"SITE_PUBLIC_ORIGIN",
		...contract.environmentRequirements
			.filter((requirement) => requirement.service === "host")
			.map((requirement) => requirement.name),
	]);
	return Object.fromEntries(
		[...names]
			.filter((name) => process.env[name] !== undefined)
			.map((name) => [name, process.env[name]]),
	);
}

export async function main(args, root = process.cwd()) {
	const [mode, value, extra, ...remaining] = args;
	if (["init", "resume"].includes(mode) && value && extra && remaining.length === 0) {
		const desired = JSON.parse(readFileSync(resolve(root, extra), "utf8"));
		return {
			result: installWorkflow(resolve(root, value), desired, { resume: mode === "resume" }),
			exitCode: 0,
		};
	}
	if (
		!["check", "plan", "prepare", "preflight", "candidate", "convex-registry"].includes(mode) ||
		!value ||
		remaining.length !== 0 ||
		(mode === "prepare" ? !extra : extra !== undefined)
	) {
		throw new Error("Invalid command.");
	}
	const contract = JSON.parse(readFileSync(resolve(root, "docs/client-integration.json"), "utf8"));
	assertContract(contract);
	let result;
	if (mode === "check") {
		const fingerprint = sourceFingerprint(root, contract);
		const issues = checkReadiness(contract, root, value, fingerprint);
		result = { environmentId: value, sourceFingerprint: fingerprint, issues };
	} else if (mode === "plan") {
		result = createSetupPlan(contract, root, value, configuredInputs(contract));
	} else if (mode === "prepare") {
		const reviewed = JSON.parse(readFileSync(resolve(root, extra), "utf8"));
		result = prepareClientSetup(contract, root, value, configuredInputs(contract), reviewed);
	} else if (mode === "preflight") {
		result = checkPreflight(contract, value, configuredInputs(contract));
	} else if (mode === "candidate") {
		result = await checkCandidate(contract, value);
	} else {
		// Check the target before reading protected data or loading optional tooling.
		checkPreflight(contract, value, {});
		const raw = await readProtectedInput(process.stdin);
		const validator = await loadRegistryValidator(root);
		result = await checkConvexRegistry(raw, contract.tenant.siteUrl, validator);
	}
	return { result, exitCode: result.issues?.length ? 1 : 0 };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const { result, exitCode } = await main(process.argv.slice(2));
		console.log(JSON.stringify(result, null, 2));
		process.exitCode = exitCode;
	} catch {
		// Parser/provider failures can contain protected input. Never echo them.
		console.error(`Client integration command failed. ${usage}`);
		process.exitCode = 1;
	}
}
