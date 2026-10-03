#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { assertRepositoryRoot } from "./release-record/cli.mjs";
import { readReleaseEvidence } from "./release-record/history.mjs";
import { statusTarget } from "./release-record/observe.mjs";

try {
	const args = process.argv.slice(2);
	if (args.length % 2) throw new Error("Expected explicit release import arguments.");
	const names = {
		"--repository": "repository",
		"--site": "siteUrl",
		"--environment": "environmentId",
		"--origin": "publicOrigin",
		"--convex-deployment": "convexDeployment",
		"--receipt": "receipt",
		"--record": "record",
	};
	const supplied = new Set();
	const options = { publicPaths: [] };
	for (let index = 0; index < args.length; index += 2) {
		const option = args[index];
		if (option === "--public-path") options.publicPaths.push(args[index + 1]);
		else {
			if (!Object.hasOwn(names, option) || supplied.has(option))
				throw new Error("Invalid argument.");
			supplied.add(option);
			options[names[option]] = args[index + 1];
		}
	}
	if (
		!/^[A-Za-z0-9][A-Za-z0-9:/-]{0,180}$/.test(options.convexDeployment ?? "") ||
		options.publicPaths.length === 0 ||
		Boolean(options.receipt) === Boolean(options.record)
	) {
		throw new Error("Select one receipt or intended record and an explicit Convex deployment.");
	}
	const root = process.cwd();
	assertRepositoryRoot(root, options.repository);
	const all = readReleaseEvidence(root, options);
	let selected;
	if (options.receipt) {
		const receipt = all.receipts.find(({ name }) => name === options.receipt);
		if (!receipt) throw new Error("Unknown retained observation receipt.");
		const reference = `docs/integration-evidence/releases/${options.environmentId}/${receipt.name}`;
		selected = {
			records: all.records.filter(
				(record) =>
					record.recordId === receipt.value.buildRecordId ||
					record.recordId === receipt.value.deploymentRecordId ||
					(record.kind === "verification" &&
						record.data.deploymentRecordId === receipt.value.deploymentRecordId &&
						record.data.checks.every((check) => check.evidenceRef === reference)),
			),
			receipts: [receipt],
		};
		if (!selected.records.some((record) => record.recordId === receipt.value.deploymentRecordId))
			throw new Error("Observation is incomplete.");
	} else {
		const intended = all.records.find(
			(record) =>
				`${record.recordId.slice(7)}.json` === options.record && record.kind === "intended",
		);
		if (!intended) throw new Error("Unknown retained intended release.");
		selected = { records: [intended], receipts: [] };
	}
	const payload = JSON.stringify({
		target: statusTarget(options),
		evidenceJson: JSON.stringify(selected),
	});
	// Stay below single-argument OS limits, including JSON escaping overhead.
	if (Buffer.byteLength(payload) > 96 * 1024)
		throw new Error("The observation exceeds the CLI import limit.");
	const result = JSON.parse(
		execFileSync(
			"pnpm",
			[
				"--filter",
				"@jessepomeroy/crm-api",
				"exec",
				"convex",
				"run",
				"platformReleaseRecordsNode:importObservation",
				payload,
				"--deployment",
				options.convexDeployment,
				"--codegen",
				"disable",
			],
			{
				cwd: root,
				encoding: "utf8",
				stdio: ["ignore", "pipe", "pipe"],
				timeout: 30_000,
				maxBuffer: 1024 * 1024,
			},
		),
	);
	if (
		!result ||
		Object.keys(result).sort().join(",") !== "changed,version" ||
		typeof result.changed !== "boolean" ||
		!Number.isSafeInteger(result.version) ||
		result.version < 1
	)
		throw new Error("Invalid import response.");
	console.log(JSON.stringify(result, null, 2));
} catch {
	console.error(
		"Release import could not be confirmed. Check the explicit target, retained evidence and authenticated Convex CLI access. Retry the same observation to reconcile a timed-out response; earlier evidence is retained. Provider output and credentials are not reported.",
	);
	process.exitCode = 1;
}
