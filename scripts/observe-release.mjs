#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";
import { readReleaseHistory, retainReleaseObservation } from "./release-record/history.mjs";
import {
	observeRelease,
	statusTarget,
	validateObservationTarget,
} from "./release-record/observe.mjs";
import { deriveReleaseStatus } from "./release-record/records.mjs";

try {
	const [command, ...args] = process.argv.slice(2);
	if (!["observe", "status"].includes(command) || args.length % 2)
		throw new Error("Expected observe or status and explicit target arguments.");
	const names = {
		"--repository": "repository",
		"--site": "siteUrl",
		"--environment": "environmentId",
		"--origin": "publicOrigin",
		"--artifact": "artifactId",
		"--deployment": "deploymentId",
		"--team": "teamId",
		"--project": "projectId",
		"--target": "target",
		"--workflow": "workflow",
	};
	const target = { workflow: ".github/workflows/ci.yml", publicPaths: [] };
	const supplied = new Set();
	for (let index = 0; index < args.length; index += 2) {
		const option = args[index];
		const value = args[index + 1];
		if (option === "--public-path") target.publicPaths.push(value);
		else {
			if (!Object.hasOwn(names, option) || supplied.has(option))
				throw new Error("Invalid argument.");
			supplied.add(option);
			target[names[option]] = value;
		}
	}
	if (command === "observe") validateObservationTarget(target);
	else deriveReleaseStatus([], statusTarget(target));
	const root = process.cwd();
	const repositoryRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 5000,
	}).trim();
	if (realpathSync(root) !== realpathSync(repositoryRoot))
		throw new Error("Run from the repository root.");
	const remote = execFileSync("git", ["remote", "get-url", "origin"], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 5000,
	}).trim();
	if (
		![
			`https://github.com/${target.repository}`,
			`https://github.com/${target.repository}.git`,
			`git@github.com:${target.repository}.git`,
		].includes(remote)
	)
		throw new Error("History repository does not match the requested target.");
	const status =
		command === "observe"
			? retainReleaseObservation(root, target, await observeRelease(target))
			: deriveReleaseStatus(readReleaseHistory(root, target), statusTarget(target));
	console.log(JSON.stringify(status, null, 2));
} catch {
	console.error(
		"Release observation could not be completed. Check explicit target, authenticated CLI access, artifact availability and retained history. No provider payloads or credentials are reported.",
	);
	process.exitCode = 1;
}
