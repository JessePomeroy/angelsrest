import { readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const metricNames = ["functionCount", "functionBytes", "largestFunctionBytes", "staticBytes"];

// Follow dependency links, counting logical file paths within each bundle. A
// shared dependency counts again in another bundle; directory cycles are errors.
function walk(path, visit, ancestors = new Set()) {
	const real = realpathSync(path);
	const stat = statSync(real);
	if (stat.isFile()) {
		visit(path, stat.size);
		return;
	}
	if (!stat.isDirectory()) throw new Error(`Unsupported build entry: ${path}`);
	if (ancestors.has(real)) throw new Error(`Directory cycle in build output: ${path}`);
	const next = new Set(ancestors).add(real);
	for (const name of readdirSync(path).sort()) walk(join(path, name), visit, next);
}

function logicalBytes(path) {
	let bytes = 0;
	walk(path, (_file, size) => {
		bytes += size;
	});
	return bytes;
}

export function measureBuild(outputDir) {
	const output = resolve(outputDir);
	const config = JSON.parse(readFileSync(join(output, "config.json"), "utf8"));
	if (config.version !== 3) throw new Error("Expected Vercel Build Output API version 3");
	const functions = new Map();
	function discover(path, ancestors = new Set()) {
		const real = realpathSync(path);
		if (!statSync(real).isDirectory()) {
			if (path.endsWith(".func")) throw new Error(`Function is not a directory: ${path}`);
			return;
		}
		if (path.endsWith(".func")) {
			// Route aliases point to the same function; count the real bundle once.
			if (!functions.has(real)) {
				const config = JSON.parse(readFileSync(join(real, ".vc-config.json"), "utf8"));
				if (typeof config.runtime !== "string") throw new Error(`Missing runtime: ${path}`);
				if (typeof config.handler !== "string" || !statSync(join(real, config.handler)).isFile())
					throw new Error(`Missing function handler: ${path}`);
				functions.set(real, {
					path: relative(output, real),
					runtime: config.runtime,
					bytes: logicalBytes(real),
				});
			}
			return;
		}
		if (ancestors.has(real)) throw new Error(`Directory cycle in function entries: ${path}`);
		const next = new Set(ancestors).add(real);
		for (const name of readdirSync(path).sort()) discover(join(path, name), next);
	}
	discover(join(output, "functions"));
	if (!functions.size) throw new Error("No function bundles found; run pnpm build first");
	const bundles = [...functions.values()].sort((a, b) => a.path.localeCompare(b.path));
	const staticBytes = logicalBytes(join(output, "static"));
	if (!staticBytes) throw new Error("Static build output is empty");
	return {
		metrics: {
			functionCount: bundles.length,
			functionBytes: bundles.reduce((total, bundle) => total + bundle.bytes, 0),
			largestFunctionBytes: Math.max(...bundles.map((bundle) => bundle.bytes)),
			staticBytes,
		},
		functions: bundles,
	};
}

export function checkBudget(measurement, budget) {
	if (typeof budget.runtime !== "string" || !budget.runtime)
		throw new Error("Budget must specify its measured runtime");
	for (const section of ["baseline", "limits"]) {
		const values = budget[section];
		if (!values || Object.keys(values).sort().join() !== [...metricNames].sort().join())
			throw new Error(`Budget ${section} must contain exactly: ${metricNames.join(", ")}`);
		for (const key of metricNames) {
			if (!Number.isSafeInteger(values[key]) || values[key] <= 0)
				throw new Error(`Invalid budget ${section}.${key}`);
		}
	}
	const failures = [];
	for (const key of metricNames) {
		if (budget.limits[key] < budget.baseline[key])
			throw new Error(`Budget limit below baseline: ${key}`);
		if (measurement.metrics[key] > budget.limits[key])
			failures.push(`${key}: ${measurement.metrics[key]} exceeds ${budget.limits[key]}`);
	}
	for (const bundle of measurement.functions) {
		if (bundle.runtime !== budget.runtime)
			failures.push(`${bundle.path}: runtime ${bundle.runtime} differs from ${budget.runtime}`);
	}
	return failures;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
	try {
		const args = process.argv.slice(2);
		if (args.some((arg) => arg !== "--json"))
			throw new Error("Usage: check-build-budget.mjs [--json]");
		const budget = JSON.parse(
			readFileSync(new URL("../build-budget.json", import.meta.url), "utf8"),
		);
		const measurement = measureBuild(".vercel/output");
		const failures = checkBudget(measurement, budget);
		if (args.includes("--json")) {
			console.log(JSON.stringify({ ...measurement, limits: budget.limits, failures }, null, 2));
		} else {
			console.log("### Build size budget\n\nLogical bytes, uncompressed; not billed storage.\n");
			console.log("| Metric | Measured | Baseline | Limit |\n| --- | ---: | ---: | ---: |");
			for (const key of metricNames)
				console.log(
					`| ${key} | ${measurement.metrics[key]} | ${budget.baseline[key]} | ${budget.limits[key]} |`,
				);
			console.log("\n| Function bundle | Bytes | Runtime |\n| --- | ---: | --- |");
			for (const bundle of measurement.functions)
				console.log(`| ${bundle.path} | ${bundle.bytes} | ${bundle.runtime} |`);
			console.log(failures.length ? `\nFAIL: ${failures.join("; ")}` : "\nPASS");
		}
		if (failures.length) process.exitCode = 1;
	} catch (error) {
		console.error(`Build budget failed: ${error.message}`);
		process.exitCode = 1;
	}
}
