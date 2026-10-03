import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	closeSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readFileSync,
	realpathSync,
	renameSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPendingManifest } from "./contract.mjs";

const distributionRoot = fileURLToPath(new URL("../../", import.meta.url));
const moduleNames = ["contract", "inventory", "preflight", "plan", "prepare", "install"];
const command = "node scripts/client-integration.mjs check";

function localDestination(root, path) {
	const target = join(root, path);
	for (let parent = dirname(target); parent !== root; parent = dirname(parent)) {
		const stat = lstatIfPresent(parent);
		if (stat) {
			if (!stat.isDirectory() || stat.isSymbolicLink()) {
				throw new Error("Installation directories must not contain symbolic links.");
			}
		}
	}
	return target;
}

function lstatIfPresent(path) {
	try {
		return lstatSync(path);
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

function publishMissingFile(target, content) {
	const temporary = join(dirname(target), `.client-integration-publish-${randomUUID()}.tmp`);
	const descriptor = openSync(temporary, "wx");
	try {
		try {
			writeFileSync(descriptor, content);
		} finally {
			closeSync(descriptor);
		}
		// Linking publishes complete bytes atomically and refuses a concurrently
		// created target. An interrupted temporary file never becomes an output.
		linkSync(temporary, target);
	} finally {
		unlinkSync(temporary);
	}
}

/** Install only the portable gate and records; host routes remain explicit work. */
export function installWorkflow(repository, desiredContract, { resume = false } = {}) {
	const manifest = createPendingManifest(desiredContract);
	const root = realpathSync(resolve(repository));
	const gitRoot = execFileSync("git", ["rev-parse", "--show-toplevel"], {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "ignore"],
	}).trim();
	if (realpathSync(gitRoot) !== root) throw new Error("Choose the repository root.");
	const packagePath = join(root, "package.json");
	const packageStat = lstatSync(packagePath);
	if (!packageStat.isFile() || packageStat.isSymbolicLink()) {
		throw new Error("package.json must be a regular local file.");
	}
	const original = readFileSync(packagePath, "utf8");
	const packageJson = JSON.parse(original);
	if (!packageJson || typeof packageJson !== "object" || Array.isArray(packageJson)) {
		throw new Error("package.json must contain an object.");
	}
	const scripts = packageJson.scripts ?? {};
	if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) {
		throw new Error("package.json scripts must be an object.");
	}
	const hasCommand = Object.hasOwn(scripts, "check:integration");
	if (hasCommand && (!resume || scripts["check:integration"] !== command)) {
		throw new Error("An integration gate already exists; adopt changes explicitly.");
	}
	const files = new Map();
	for (const path of [
		"scripts/client-integration.mjs",
		...moduleNames.map((name) => `scripts/client-integration/${name}.mjs`),
		"docs/contracts/client-setup.md",
		"docs/templates/client-integration.md",
	]) {
		files.set(path, readFileSync(join(distributionRoot, path), "utf8"));
	}
	files.set(
		"docs/CLIENT_INTEGRATION.md",
		readFileSync(join(distributionRoot, "docs/templates/client-integration.md"), "utf8"),
	);
	files.set("docs/client-integration.json", `${JSON.stringify(manifest, null, 2)}\n`);
	const missing = new Map();
	for (const [path, content] of files) {
		const target = localDestination(root, path);
		const stat = lstatIfPresent(target);
		if (!stat) {
			missing.set(path, content);
		} else if (!resume) {
			throw new Error("An installation target exists; inspect it before adopting changes.");
		} else if (
			!stat.isFile() ||
			stat.isSymbolicLink() ||
			!readFileSync(target).equals(Buffer.from(content))
		) {
			throw new Error("Existing installation content differs; preserve it and review adoption.");
		}
	}
	// Resume fills only missing outputs after validating every existing byte. A
	// changed tool, contract, evidence record or runbook requires explicit adoption.
	for (const [path, content] of missing) {
		const target = localDestination(root, path);
		mkdirSync(dirname(target), { recursive: true });
		publishMissingFile(target, content);
	}
	if (readFileSync(packagePath, "utf8") !== original) {
		throw new Error("package.json changed during installation; reconcile the partial install.");
	}
	const written = [...missing.keys()];
	if (!hasCommand) {
		packageJson.scripts = { ...scripts, "check:integration": command };
		const indent = original.match(/\n([ \t]+)"/)?.[1] ?? "  ";
		const temporary = join(root, `.client-integration-package-${randomUUID()}.tmp`);
		writeFileSync(temporary, `${JSON.stringify(packageJson, null, indent)}\n`, {
			flag: "wx",
			mode: packageStat.mode & 0o777,
		});
		renameSync(temporary, packagePath);
		written.push("package.json");
	}
	return { files: written, verification: "pending", resumed: resume };
}
