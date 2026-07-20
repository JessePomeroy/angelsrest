import { readFile, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	assertSanityCatalogV2GraphPlan,
	type SanityCatalogV2GraphPlan,
} from "../../packages/crm-api/convex/helpers/sanityCatalogGraphPlan";
import { resolveCatalogDryRunOutputPath } from "./sanityCatalogDryRunSafety";

const DEFAULT_GRAPH_PLAN_PATH = "/tmp/angelsrest-sanity-catalog-graph-plan.json";
const DEFAULT_OUTPUT_PATH = "/tmp/angelsrest-sanity-catalog-import-execution-report.json";
const PRODUCTION_ORIGIN = "https://www.angelsrest.online";
const SITE_URL = "angelsrest.online";
const CONFIRMATION = "import CMS-5.3d unpublished catalog drafts to angelsrest.online";

type Options =
	| { mode: "plan"; graphPlanPath: string; outputPath: string }
	| {
			mode: "execute";
			graphPlanPath: string;
			outputPath: string;
			cookieFile: string;
	  };

function parseArgs(args: string[]): Options {
	let execute = false;
	let confirm = "";
	let cookieFile = "";
	let graphPlanPath = DEFAULT_GRAPH_PLAN_PATH;
	let outputPath = DEFAULT_OUTPUT_PATH;
	for (let index = 0; index < args.length; index += 1) {
		const arg = args[index];
		if (arg === "--") continue;
		if (arg === "--execute") {
			execute = true;
			continue;
		}
		if (arg === "--confirm") {
			confirm = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (arg === "--cookie-file") {
			cookieFile = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (arg === "--graph-plan") {
			graphPlanPath = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		if (arg === "--output") {
			outputPath = args[index + 1] ?? "";
			index += 1;
			continue;
		}
		throw new Error(`Unsupported argument: ${arg}`);
	}
	const resolvedPlan = resolveCatalogDryRunOutputPath(graphPlanPath);
	const resolvedOutput = resolveCatalogDryRunOutputPath(outputPath);
	if (!execute) return { mode: "plan", graphPlanPath: resolvedPlan, outputPath: resolvedOutput };
	if (confirm !== CONFIRMATION) {
		throw new Error(`--confirm must exactly equal: ${CONFIRMATION}`);
	}
	if (!cookieFile) throw new Error("--cookie-file is required for execution");
	return {
		mode: "execute",
		graphPlanPath: resolvedPlan,
		outputPath: resolvedOutput,
		cookieFile: resolve(cookieFile),
	};
}

function asObject(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be an object`);
	}
	return value as Record<string, unknown>;
}

async function loadGraphPlan(path: string) {
	const report = asObject(
		JSON.parse(await readFile(path, "utf8")) as unknown,
		"Catalog graph-plan report",
	);
	const plan = await assertSanityCatalogV2GraphPlan(report.plan as SanityCatalogV2GraphPlan);
	if (report.evidence && typeof report.evidence === "object") {
		const evidence = report.evidence as Record<string, unknown>;
		if (evidence.graphPlanChecksum !== plan.graphPlanChecksum) {
			throw new Error("Catalog graph-plan report checksum does not match its plan");
		}
	}
	return plan;
}

async function loadCookie(cookieFile: string) {
	const cookie = (await readFile(cookieFile, "utf8")).trim();
	if (!cookie || cookie.length < 20) throw new Error("Admin cookie file is empty or invalid");
	return cookie;
}

async function writePrivateJson(path: string, value: unknown) {
	await rm(path, { force: true });
	await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx", mode: 0o600 });
}

async function executeImport(
	options: Extract<Options, { mode: "execute" }>,
	plan: SanityCatalogV2GraphPlan,
) {
	const cookie = await loadCookie(options.cookieFile);
	const response = await fetch(`${PRODUCTION_ORIGIN}/api/admin/mutation`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Cookie: cookie,
		},
		body: JSON.stringify({
			name: "catalogProductGraphs:importSanityDrafts",
			args: { siteUrl: SITE_URL, plan },
		}),
	});
	const body = (await response.json().catch(() => null)) as unknown;
	if (!response.ok) {
		throw new Error(
			`Catalog import request failed with ${response.status}: ${JSON.stringify(body)}`,
		);
	}
	const result = asObject(body, "Catalog import response").result;
	const output = {
		generatedAt: new Date().toISOString(),
		origin: PRODUCTION_ORIGIN,
		siteUrl: SITE_URL,
		graphPlanChecksum: plan.graphPlanChecksum,
		result,
	};
	await writePrivateJson(options.outputPath, output);
	return output;
}

async function main() {
	const options = parseArgs(process.argv.slice(2));
	const plan = await loadGraphPlan(options.graphPlanPath);
	if (options.mode === "plan") {
		console.log(
			`Catalog import ready: ${plan.products.length} products; checksum ${plan.graphPlanChecksum}; run with --execute --confirm "${CONFIRMATION}" --cookie-file /tmp/angelsrest-admin-cookie.txt`,
		);
		return;
	}
	const output = await executeImport(options, plan);
	const result = asObject(output.result, "Catalog import result");
	console.log(
		`Catalog import ${result.status}: ${String(result.productCount)} products; checksum ${output.graphPlanChecksum}; report ${options.outputPath}`,
	);
}

main().catch((error) => {
	console.error(error instanceof Error ? error.message : error);
	process.exitCode = 1;
});
