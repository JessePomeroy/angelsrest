#!/usr/bin/env node
import { assessAdminAdoption } from "./release-record/adoption.mjs";
import { assertRepositoryRoot } from "./release-record/cli.mjs";
import { readReleaseEvidence } from "./release-record/history.mjs";
import { statusTarget } from "./release-record/observe.mjs";

try {
	const args = process.argv.slice(2);
	const names = {
		"--repository": "repository",
		"--site": "siteUrl",
		"--candidate": "candidateRevision",
		"--version": "version",
		"--staging-origin": "stagingOrigin",
		"--production-origin": "productionOrigin",
	};
	const values = { publicPaths: [] };
	if (args.length % 2) throw new Error("Expected option/value pairs.");
	for (let index = 0; index < args.length; index += 2) {
		const [option, value] = args.slice(index, index + 2);
		if (option === "--public-path") values.publicPaths.push(value);
		else {
			if (!Object.hasOwn(names, option) || Object.hasOwn(values, names[option]))
				throw new Error("Invalid argument.");
			values[names[option]] = value;
		}
	}
	if (values.publicPaths.length === 0)
		throw new Error("An explicit verification policy is required.");
	const root = process.cwd();
	assertRepositoryRoot(root, values.repository);
	const environment = (environmentId, publicOrigin) => {
		const target = {
			repository: values.repository,
			siteUrl: values.siteUrl,
			environmentId,
			publicOrigin,
			publicPaths: values.publicPaths,
		};
		return { records: readReleaseEvidence(root, target).records, target: statusTarget(target) };
	};
	const result = assessAdminAdoption({
		staging: environment("staging", values.stagingOrigin),
		production: environment("production", values.productionOrigin),
		candidateRevision: values.candidateRevision,
		version: values.version,
	});
	console.log(JSON.stringify(result, null, 2));
	if (!result.evidenceReady) process.exitCode = 1;
} catch {
	console.error(
		"Adoption evidence could not be checked. Confirm explicit targets, candidate and retained observation receipts. No deployment or rollback was performed.",
	);
	process.exitCode = 1;
}
