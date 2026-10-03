#!/usr/bin/env node
import { lstatSync, mkdirSync, realpathSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { buildReleaseRecord } from "./release-record/build.mjs";

try {
	if (process.argv.length !== 3 || process.argv[2] !== "build")
		throw new Error("Unsupported release-record command.");
	const root = process.cwd();
	const record = buildReleaseRecord(root, process.env);
	const directory = resolve(realpathSync(root), ".output/release-record");
	for (const path of [dirname(directory), directory]) {
		try {
			if (!lstatSync(path).isDirectory())
				throw new Error("Release output directories must be local directories.");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			mkdirSync(path);
		}
	}
	writeFileSync(resolve(directory, "build.json"), `${JSON.stringify(record, null, 2)}\n`, {
		flag: "wx",
	});
	console.log(
		JSON.stringify({ recordId: record.recordId, sourceRevision: record.data.sourceRevision }),
	);
} catch {
	console.error(
		"Release record could not be generated. Check source, packages, configuration and CI observations; no provider payload or environment values are reported.",
	);
	process.exitCode = 1;
}
