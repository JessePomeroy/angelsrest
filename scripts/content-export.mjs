import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { lstat, mkdir, readFile, realpath, rename, rm, rmdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve, sep } from "node:path";
import { Readable, Transform } from "node:stream";
import { pipeline } from "node:stream/promises";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
	createContentExportPackage,
	exportFingerprint as digest,
	ContentExportError as ExportError,
	exportJson as encoder,
	exportCounts,
	exportInvariant as invariant,
	prepareContentExport as prepare,
	readContentExportInventory,
} from "@jessepomeroy/admin/content-export";
import { ConvexHttpClient } from "convex/browser";
import { makeFunctionReference } from "convex/server";

export { prepare };

function configCheck(config) {
	invariant(
		config && /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(config.siteUrl),
		"Invalid canonical site hostname",
	);
	for (const name of ["workerUrl", "convexUrl"]) {
		const url = new URL(config[name]);
		invariant(
			url.protocol === "https:" &&
				!url.username &&
				!url.password &&
				!url.search &&
				!url.hash &&
				url.pathname === "/",
			"Export endpoints must be HTTPS origins",
		);
	}
	invariant(
		typeof config.token === "string" &&
			config.token.length > 0 &&
			typeof config.workerSecret === "string" &&
			config.workerSecret.length > 0,
		"Export credentials are required",
	);
}
export function inventory(config, client) {
	return readContentExportInventory(config.siteUrl, (family, cursor) =>
		client.query(makeFunctionReference("contentExport:page"), {
			siteUrl: config.siteUrl,
			family,
			paginationOpts: { cursor, numItems: 1 },
		}),
	);
}
async function privateDirectory(path, create = false) {
	if (create) await mkdir(path, { mode: 0o700 });
	const meta = await lstat(path);
	invariant(
		meta.isDirectory() && !meta.isSymbolicLink() && (meta.mode & 0o077) === 0,
		"Export directory must be a private, non-symlink directory",
	);
	invariant((await realpath(path)) === resolve(path), "Export path must not contain symlinks");
	// Content packages and credentials never belong inside a checkout.
	for (let dir = resolve(path); ; dir = dirname(dir)) {
		try {
			await lstat(join(dir, ".git"));
			throw new Error("Export output must be outside Git repositories");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
		}
		if (dirname(dir) === dir) break;
	}
}
async function hashStream(stream, expectedSize = Number.MAX_SAFE_INTEGER) {
	let sizeBytes = 0;
	const hash = createHash("sha256");
	for await (const chunk of stream) {
		sizeBytes += chunk.length;
		invariant(sizeBytes <= expectedSize, "Export file exceeds expected size");
		hash.update(chunk);
	}
	return { sizeBytes, sha256: hash.digest("hex") };
}
async function fileHash(path) {
	const meta = await lstat(path);
	invariant(meta.isFile() && !meta.isSymbolicLink(), "Export file must be a regular file");
	return hashStream(createReadStream(path));
}
async function save(path, value) {
	await writeFile(path, typeof value === "string" ? value : encoder(value), {
		mode: 0o600,
		flag: "wx",
	});
}
async function command(program, args, options = {}) {
	const child = spawn(program, args, { ...options, stdio: ["pipe", "pipe", "pipe"] });
	const completion = new Promise((resolvePromise, reject) => {
		child.stdin.on("error", () => reject(new Error(`Archive input failed: ${program}`)));
		child.on("error", () => reject(new Error(`Required archive tool unavailable: ${program}`)));
		child.on("close", (code) =>
			code === 0
				? resolvePromise()
				: reject(new Error(`Archive verification command failed: ${program}`)),
		);
	});
	child.stderr.resume();
	return { child, completion };
}
async function archivePackage(workspace, entries) {
	const archive = join(workspace, "content-export.partial.zip");
	await rm(archive, { force: true });
	const helper = fileURLToPath(new URL("./content-export-archive.py", import.meta.url));
	const { child, completion } = await command("python3", [
		helper,
		join(workspace, "package"),
		archive,
	]);
	child.stdout.resume();
	child.stdin.end(JSON.stringify(entries));
	await completion;
	return fileHash(archive);
}
export async function run(config, mode, output, { client, fetcher = fetch } = {}) {
	configCheck(config);
	client ??= new ConvexHttpClient(config.convexUrl, { logger: false });
	client.setAuth(config.token);
	invariant(["plan", "export", "resume"].includes(mode), "Choose plan, export, or resume");
	const source = await inventory(config, client);
	const fingerprint = await digest(source);
	const plan = prepare(source);
	const counts = exportCounts(source);
	if (mode === "plan")
		return {
			siteUrl: source.siteUrl,
			fingerprint,
			counts,
			mediaFiles: plan.files.length,
			bytes: plan.totalBytes,
			exceptions: plan.exceptions.length,
			complete: false,
			note: "Inventory only; object availability is verified during export.",
		};
	invariant(isAbsolute(output ?? ""), "Export output must be an absolute path outside Git");
	const workspace = resolve(output);
	await privateDirectory(workspace, mode === "export");
	const lock = join(workspace, ".export-lock");
	await mkdir(lock, { mode: 0o700 });
	try {
		const checkpointPath = join(workspace, "checkpoint.json");
		let checkpoint = {
			schemaVersion: 1,
			siteUrl: source.siteUrl,
			fingerprint,
			createdAt: new Date().toISOString(),
			completed: {},
		};
		if (mode === "resume") {
			checkpoint = JSON.parse(await readFile(checkpointPath, "utf8"));
			invariant(
				checkpoint.siteUrl === source.siteUrl &&
					checkpoint.fingerprint === fingerprint &&
					checkpoint.schemaVersion === 1 &&
					typeof checkpoint.createdAt === "string" &&
					checkpoint.completed &&
					typeof checkpoint.completed === "object",
				"Source changed or checkpoint is invalid; start a new export directory",
			);
			try {
				await lstat(join(workspace, "content-export.zip"));
				throw new Error("Export archive already exists; use a new directory");
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
			}
		} else await save(checkpointPath, checkpoint);
		const packagePath = join(workspace, "package");
		await mkdir(packagePath, { mode: 0o700, recursive: true });
		await privateDirectory(packagePath);
		for (const asset of plan.files) {
			const target = join(packagePath, asset.path);
			invariant(target.startsWith(packagePath + sep), "Unsafe export path");
			await mkdir(dirname(target), { recursive: true, mode: 0o700 });
			invariant(
				(await realpath(dirname(target))) === dirname(target),
				"Export media path contains a symlink",
			);
			if (checkpoint.completed[asset.path]) {
				const actual = await fileHash(target);
				const saved = checkpoint.completed[asset.path];
				invariant(
					actual.sizeBytes === asset.sizeBytes &&
						actual.sha256 === saved.sha256 &&
						(!asset.sha256 || actual.sha256 === asset.sha256),
					"Resumed media checksum mismatch",
				);
				continue;
			}
			const temporary = `${target}.partial`;
			await rm(temporary, { force: true });
			const response = await fetcher(new URL("/v1/content-export/asset", config.workerUrl), {
				method: "POST",
				redirect: "error",
				signal: AbortSignal.timeout(30 * 60 * 1000),
				headers: {
					Authorization: `Bearer ${config.workerSecret}`,
					"Content-Type": "application/json",
				},
				body: JSON.stringify({
					siteUrl: source.siteUrl,
					kind: asset.kind,
					assetKey: asset.assetKey,
				}),
			});
			invariant(
				response.ok &&
					response.body &&
					response.headers.get("content-type")?.split(";")[0] === asset.mimeType &&
					Number(response.headers.get("content-length")) === asset.sizeBytes,
				"Export media unavailable or metadata mismatch; resume after resolving it",
			);
			let sizeBytes = 0;
			const hash = createHash("sha256");
			const meter = new Transform({
				transform(chunk, _, callback) {
					sizeBytes += chunk.length;
					if (sizeBytes > asset.sizeBytes) {
						callback(new Error("Export media exceeds declared size"));
						return;
					}
					hash.update(chunk);
					callback(null, chunk);
				},
			});
			await pipeline(
				Readable.fromWeb(response.body),
				meter,
				createWriteStream(temporary, { mode: 0o600, flags: "wx" }),
			);
			const sha256 = hash.digest("hex");
			invariant(
				sizeBytes === asset.sizeBytes && (!asset.sha256 || asset.sha256 === sha256),
				"Export media checksum or byte count mismatch",
			);
			// An interrupted rename can leave a verified file ahead of its checkpoint; recheck rather than overwrite.
			try {
				const existing = await fileHash(target);
				invariant(existing.sha256 === sha256, "Export target already contains different data");
				await rm(temporary);
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				await rename(temporary, target);
			}
			checkpoint.completed[asset.path] = { sizeBytes, sha256 };
			const next = join(workspace, "checkpoint.next.json");
			await rm(next, { force: true });
			await save(next, checkpoint);
			await rename(next, checkpointPath);
		}
		invariant(
			(await digest(await inventory(config, client))) === fingerprint,
			"Content changed during export; retained files can be inspected, but no complete archive was created",
		);
		const { metadata, entries } = await createContentExportPackage(
			source,
			plan,
			checkpoint.completed,
			checkpoint.createdAt,
		);
		for (const [path, value] of Object.entries(metadata)) {
			const target = join(packagePath, path);
			await mkdir(dirname(target), { recursive: true, mode: 0o700 });
			invariant(
				(await realpath(dirname(target))) === dirname(target),
				"Export output contains a symlink",
			);
			try {
				invariant((await readFile(target, "utf8")) === value, "Existing export metadata differs");
			} catch (error) {
				if (error.code !== "ENOENT") throw error;
				await save(target, value);
			}
		}
		const archive = await archivePackage(workspace, entries);
		invariant(
			(await digest(await inventory(config, client))) === fingerprint,
			"Content changed during archive verification; no complete archive was created",
		);
		await rename(
			join(workspace, "content-export.partial.zip"),
			join(workspace, "content-export.zip"),
		);
		const receipt = {
			complete: true,
			siteUrl: source.siteUrl,
			fingerprint,
			counts,
			mediaFiles: plan.files.length,
			archive: { path: "content-export.zip", ...archive },
			exceptions: plan.exceptions.length,
		};
		await save(join(workspace, "receipt.json"), receipt);
		return receipt;
	} finally {
		await rmdir(lock);
	}
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
	process.umask(0o077);
	try {
		const [, , configPath, mode, output] = process.argv;
		const metadata = await lstat(configPath);
		invariant(
			metadata.isFile() && !metadata.isSymbolicLink() && (metadata.mode & 0o077) === 0,
			"Configuration must be a private regular file (chmod 600)",
		);
		console.log(encoder(await run(JSON.parse(await readFile(configPath, "utf8")), mode, output)));
	} catch (error) {
		if (error instanceof ExportError) console.error(error.message);
		// Upstream errors can contain tokens, URLs or content. Keep them out of logs.
		console.error(
			"Content export did not complete. Check private configuration, source access, source stability, file availability and archive tools. Retain the private workspace for diagnosis/resume.",
		);
		process.exitCode = 1;
	}
}
