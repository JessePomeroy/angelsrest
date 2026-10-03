import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join, relative, resolve } from "node:path";

export const SHARED_PACKAGES = Object.freeze([
	"@jessepomeroy/admin",
	"@jessepomeroy/crm-api",
	"@jessepomeroy/gallery-delivery",
	"@jessepomeroy/print-catalog",
]);
const versionPattern = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

function run(command, args, root) {
	return execFileSync(command, args, {
		cwd: root,
		encoding: "utf8",
		stdio: ["ignore", "pipe", "pipe"],
		timeout: 30_000,
		maxBuffer: 8 * 1024 * 1024,
	});
}

function installedManifest(root, name) {
	const require = createRequire(resolve(root, "package.json"));
	try {
		return JSON.parse(readFileSync(require.resolve(`${name}/package.json`), "utf8"));
	} catch {
		let directory = dirname(require.resolve(name));
		while (true) {
			try {
				const manifest = JSON.parse(readFileSync(join(directory, "package.json"), "utf8"));
				if (manifest.name === name) return manifest;
			} catch {
				// An exported entry can hide package.json; inspect its parents without loading code.
			}
			const parent = dirname(directory);
			if (directory === parent) throw new Error("Installed package metadata is unavailable.");
			directory = parent;
		}
	}
}

/** Compare the installed direct resolutions with pnpm's lockfile view, without network access. */
export function collectPackages(
	root,
	execute = run,
	names = SHARED_PACKAGES,
	workspaceSources = ["@jessepomeroy/crm-api"],
) {
	const list = (extra) =>
		JSON.parse(execute("pnpm", ["list", "--recursive", "--depth", "0", "--json", ...extra], root));
	const installed = list([]);
	const locked = list(["--lockfile-only"]);
	if (!Array.isArray(installed) || !Array.isArray(locked))
		throw new Error("Package observations are unavailable.");
	const rootPath = realpathSync(root);
	const host = installed.find((item) => item.path && realpathSync(item.path) === rootPath);
	const lockHost = locked.find((item) => item.path && realpathSync(item.path) === rootPath);
	if (!host || !lockHost) throw new Error("The host package observation is missing.");
	const resolution = (entry, name) =>
		entry.dependencies?.[name] ??
		entry.devDependencies?.[name] ??
		entry.optionalDependencies?.[name];
	const workspacePackage = (name, directory) => {
		const path = realpathSync(directory);
		const inside = relative(rootPath, path);
		if (!inside || inside === ".." || inside.startsWith("../") || inside.startsWith("/"))
			throw new Error("A workspace package escaped the host repository.");
		const manifest = JSON.parse(readFileSync(join(path, "package.json"), "utf8"));
		const matching = (items) =>
			items.find((item) => item.name === name && item.path && realpathSync(item.path) === path);
		if (
			manifest.name !== name ||
			!versionPattern.test(manifest.version) ||
			matching(installed)?.version !== manifest.version ||
			matching(locked)?.version !== manifest.version
		)
			throw new Error("Workspace package versions disagree.");
		return { name, version: manifest.version, source: "workspace" };
	};
	return names.map((name) => {
		const installedVersion = resolution(host, name)?.version;
		const lockedVersion = resolution(lockHost, name)?.version;
		if (installedVersion === undefined && lockedVersion === undefined) {
			// The hub compiles CRM source through $convex without a direct package dependency.
			const candidates = installed.filter((item) => item.name === name && item.path !== host.path);
			if (!workspaceSources.includes(name) || candidates.length !== 1)
				throw new Error("A required host package is not installed.");
			return workspacePackage(name, candidates[0].path);
		}
		if (typeof installedVersion !== "string" || installedVersion !== lockedVersion)
			throw new Error("Installed shared packages disagree with the lockfile.");
		if (installedVersion.startsWith("link:")) {
			const path = realpathSync(join(rootPath, "node_modules", name));
			if (path !== realpathSync(resolve(rootPath, installedVersion.slice(5))))
				throw new Error("The installed workspace link differs from the lockfile.");
			return workspacePackage(name, path);
		}
		const actual = installedManifest(root, name);
		if (
			actual.name !== name ||
			!versionPattern.test(actual.version) ||
			actual.version !== installedVersion ||
			actual.version !== lockedVersion
		)
			throw new Error("Installed shared packages disagree with the lockfile.");
		return { name, version: actual.version, source: "installed" };
	});
}

/** Identify only public client assets. Server bundles and private environment values are excluded. */
export function clientAssetsDigest(root) {
	const directory = resolve(root, ".svelte-kit/output/client");
	if (realpathSync(directory) !== join(realpathSync(root), ".svelte-kit/output/client"))
		throw new Error("Client assets cannot use symbolic-link parents.");
	const files = [];
	let bytes = 0;
	const visit = (path) => {
		if (!lstatSync(path).isDirectory()) throw new Error("Client assets must be regular files.");
		for (const name of readdirSync(path).sort()) {
			const file = join(path, name);
			const stat = lstatSync(file);
			if (stat.isSymbolicLink()) throw new Error("Client assets cannot contain symbolic links.");
			if (stat.isDirectory()) visit(file);
			else if (stat.isFile()) {
				bytes += stat.size;
				if (files.length >= 20_000 || bytes > 256 * 1024 * 1024)
					throw new Error("Client assets exceed the observation limit.");
				files.push([relative(directory, file), readFileSync(file)]);
			} else throw new Error("Client assets must be regular files.");
		}
	};
	visit(directory);
	if (!files.length) throw new Error("Built client assets are missing.");
	const hash = createHash("sha256");
	for (const [path, content] of files.sort(([left], [right]) =>
		left < right ? -1 : left > right ? 1 : 0,
	)) {
		hash
			.update(JSON.stringify([path, content.length]))
			.update("\0")
			.update(content)
			.update("\0");
	}
	return {
		scope: "static-client-assets",
		digest: hash.digest("hex"),
		fileCount: files.length,
		bytes,
	};
}

export function checkedOutSource(root, expectedRevision, execute = run) {
	const sourceRevision = execute("git", ["rev-parse", "--verify", "HEAD"], root).trim();
	if (!/^[a-f0-9]{40}$/.test(sourceRevision) || sourceRevision !== expectedRevision)
		throw new Error("The CI revision does not match the actual checkout.");
	if (execute("git", ["status", "--porcelain", "--untracked-files=all"], root).trim())
		throw new Error("Release records require an unchanged checkout.");
	return sourceRevision;
}

export function fileDigest(path) {
	if (!lstatSync(path).isFile()) throw new Error("A release input must be a regular file.");
	return createHash("sha256").update(readFileSync(path)).digest("hex");
}
