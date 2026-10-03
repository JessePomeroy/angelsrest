import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readFileSync, realpathSync, statSync } from "node:fs";
import { isAbsolute, relative, resolve } from "node:path";
import {
	assertContract,
	CAPABILITY_STAGES,
	contractFingerprint,
	getEnvironment,
	isRepositoryPath,
	validateContract,
} from "./contract.mjs";

const sourcePaths = [
	"src",
	"tests",
	"scripts",
	"static",
	"packages",
	"workers",
	"convex",
	".github/workflows",
	"package.json",
	"pnpm-lock.yaml",
	"package-lock.json",
	"yarn.lock",
	"bun.lock",
	"bun.lockb",
	"pnpm-workspace.yaml",
	"vercel.json",
	"*.config.*",
	".env.example",
];
const isEvidencePath = (path) => path.startsWith("docs/integration-evidence/");

function inside(root, path) {
	const destination = relative(root, path);
	return destination !== ".." && !destination.startsWith("../") && !isAbsolute(destination);
}

/** Resolve both lexical traversal and symlinks; callers never read an escaped target. */
export function resolveRepositoryFile(root, path) {
	if (!isRepositoryPath(path)) return null;
	try {
		const repository = realpathSync(root);
		const resolved = realpathSync(resolve(repository, path));
		return inside(repository, resolved) &&
			isRepositoryPath(relative(repository, resolved)) &&
			statSync(resolved).isFile()
			? resolved
			: null;
	} catch {
		return null;
	}
}

function requiredFiles(contract) {
	return [
		...contract.stages.flatMap((stage) =>
			stage.requiredFiles.map((path) => ({ path, stage: stage.id, capability: null })),
		),
		...Object.entries(contract.capabilities).flatMap(([id, capability]) =>
			capability.requiredFiles.map((path) => ({
				path,
				stage: CAPABILITY_STAGES[id],
				capability: id,
			})),
		),
	];
}

function nonemptyFile(root, path) {
	const resolved = resolveRepositoryFile(root, path);
	try {
		return resolved !== null && readFileSync(resolved, "utf8").trim().length > 0;
	} catch {
		return false;
	}
}

export function inspectInventory(contract, root) {
	const issues = validateContract(contract);
	if (issues.length) return { issues, files: [] };
	const files = requiredFiles(contract).map((entry) => {
		const present = nonemptyFile(root, entry.path);
		if (!present) issues.push(`${entry.stage}: missing, empty, or unsafe file ${entry.path}.`);
		return { ...entry, present };
	});
	return { issues, files };
}

/** Hash working files, including untracked changes, independently of Git staging. */
export function sourceFingerprint(root, contract) {
	assertContract(contract);
	const repository = realpathSync(root);
	const git = (args) =>
		execFileSync("git", args, { cwd: repository, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
	if (realpathSync(git(["rev-parse", "--show-toplevel"]).trim()) !== repository) {
		throw new Error("Source fingerprints require the repository root.");
	}
	const tracked = git([
		"ls-files",
		"--cached",
		"--others",
		"--exclude-standard",
		"-z",
		"--",
		...sourcePaths,
	]);
	const paths = new Set([
		...tracked.split("\0").filter(Boolean),
		...requiredFiles(contract).map(({ path }) => path),
	]);
	const hash = createHash("sha256").update(
		`client-integration-v2\0${contractFingerprint(contract)}\0`,
	);
	for (const path of [...paths].sort()) {
		// Desired setup is hashed separately; recording observations cannot certify itself.
		if (path === "docs/client-integration.json" || isEvidencePath(path)) continue;
		let stat;
		try {
			stat = lstatSync(resolve(repository, path));
		} catch (error) {
			if (error.code === "ENOENT") continue;
			throw new Error("A source file could not be inspected.");
		}
		const file = resolveRepositoryFile(repository, path);
		if (!file || (!stat.isFile() && !stat.isSymbolicLink())) {
			throw new Error("A source file is not a regular repository-contained file.");
		}
		const content = readFileSync(file);
		hash
			.update(JSON.stringify([path, relative(repository, file), content.byteLength]))
			.update("\0")
			.update(content)
			.update("\0");
	}
	return hash.digest("hex");
}

/** Check recorded evidence, not the truth of its prose or live provider state. */
export function checkReadiness(contract, root, environmentId, fingerprint) {
	const schemaIssues = validateContract(contract);
	if (schemaIssues.length) return schemaIssues;
	try {
		getEnvironment(contract, environmentId);
	} catch {
		return ["The requested environment is not declared in the setup contract."];
	}
	const { issues } = inspectInventory(contract, root);
	let source = fingerprint;
	try {
		source ??= sourceFingerprint(root, contract);
		if (typeof source !== "string" || !/^[a-f0-9]{64}$/.test(source)) throw new Error();
	} catch {
		issues.push("Current repository source could not be fingerprinted safely.");
		return issues;
	}
	const desired = contractFingerprint(contract);
	const observedTenants = new Set();
	for (const stage of contract.stages) {
		const evidence = stage.verification[environmentId];
		if (!evidence) {
			issues.push(`${stage.id}: verification is pending for ${environmentId}.`);
			continue;
		}
		if (evidence.environmentId !== environmentId)
			issues.push(`${stage.id}: evidence belongs to another environment.`);
		if (
			evidence.siteUrl !== contract.tenant.siteUrl ||
			evidence.tenantId === null ||
			(contract.tenant.expectedTenantId !== null &&
				evidence.tenantId !== contract.tenant.expectedTenantId)
		) {
			issues.push(`${stage.id}: evidence does not establish the intended tenant binding.`);
		}
		observedTenants.add(evidence.tenantId);
		if (evidence.sourceFingerprint !== source)
			issues.push(`${stage.id}: verification is stale for the current source.`);
		if (evidence.contractFingerprint !== desired)
			issues.push(`${stage.id}: verification is stale for the desired contract.`);
		if (!nonemptyFile(root, evidence.evidenceFile))
			issues.push(`${stage.id}: a nonempty repository-contained evidence file is required.`);
		if (Date.parse(evidence.verifiedAt) > Date.now() + 5 * 60_000)
			issues.push(`${stage.id}: verification cannot be recorded in the future.`);
		const expectedChecks = new Map(
			Object.entries(contract.capabilities)
				.filter(([id]) => CAPABILITY_STAGES[id] === stage.id)
				.flatMap(([id, capability]) =>
					capability.checks.map((check) => [
						`${id}.${check.id}`,
						capability.status === "included" ? "passed" : "unavailable",
					]),
				),
		);
		for (const [id, outcome] of expectedChecks) {
			if (evidence.checks[id] !== outcome)
				issues.push(`${stage.id}: ${id} requires a recorded ${outcome} outcome.`);
		}
		if (Object.keys(evidence.checks).some((id) => !expectedChecks.has(id))) {
			issues.push(`${stage.id}: evidence contains checks outside this stage's declared scope.`);
		}
	}
	if (observedTenants.size > 1)
		issues.push("Stage evidence refers to different immutable tenants.");
	return issues;
}
