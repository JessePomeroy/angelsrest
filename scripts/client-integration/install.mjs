import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
	lstatSync,
	mkdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	writeFileSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createPendingManifest } from "./contract.mjs";

const distributionRoot = fileURLToPath(new URL("../../", import.meta.url));
const moduleNames = ["contract", "inventory", "preflight", "plan", "install"];
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

/** Install only the portable gate and records; host routes remain explicit work. */
export function installWorkflow(repository, desiredContract) {
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
	if (Object.hasOwn(scripts, "check:integration")) {
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
	for (const path of files.keys()) {
		if (lstatIfPresent(localDestination(root, path))) {
			throw new Error("An installation target exists; inspect it before adopting changes.");
		}
	}
	// Validate all destinations before the first write. An interruption leaves its
	// partial files visible for reconciliation, never silently overwritten on retry.
	for (const [path, content] of files) {
		const target = localDestination(root, path);
		mkdirSync(dirname(target), { recursive: true });
		writeFileSync(target, content, { flag: "wx" });
	}
	if (readFileSync(packagePath, "utf8") !== original) {
		throw new Error("package.json changed during installation; reconcile the partial install.");
	}
	packageJson.scripts = { ...scripts, "check:integration": command };
	const indent = original.match(/\n([ \t]+)"/)?.[1] ?? "  ";
	const temporary = join(root, `.client-integration-package-${randomUUID()}.tmp`);
	writeFileSync(temporary, `${JSON.stringify(packageJson, null, indent)}\n`, {
		flag: "wx",
		mode: packageStat.mode & 0o777,
	});
	renameSync(temporary, packagePath);
	return { files: [...files.keys(), "package.json"], verification: "pending" };
}
