import { spawnSync } from "node:child_process";
import { chmod, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { afterEach, describe, expect, test } from "vitest";
import {
	V2_CANARY_ARTIFACT_DIRECTORY,
	V2_CANARY_ARTIFACT_WRITE_FAILURE_STDERR,
	V2_CANARY_FAILURE_STDERR,
} from "./sanityCatalogPrivateAssetV2Canary";

const temporaryDirectories: string[] = [];
const entrypoint = resolve("scripts/cms/sanity-catalog-private-assets-v2-canary.ts");
const tsxCli = resolve("node_modules/tsx/dist/cli.mjs");
const artifactDirectoryName = basename(V2_CANARY_ARTIFACT_DIRECTORY);

function runEntrypoint(root: string) {
	return spawnSync(process.execPath, [tsxCli, entrypoint, "--execute"], {
		cwd: resolve("."),
		env: { ...process.env, TMPDIR: root, NO_COLOR: "1" },
		encoding: "utf8",
	});
}

afterEach(async () => {
	await Promise.all(
		temporaryDirectories.splice(0).map((path) => rm(path, { force: true, recursive: true })),
	);
});

describe("catalog private asset V2 canary entrypoint", () => {
	test("wires execution failures to a fresh private forensic artifact without sensitive stderr", async () => {
		const root = await mkdtemp(join(tmpdir(), "v2-canary-entrypoint-test-"));
		temporaryDirectories.push(root);
		const directory = join(root, artifactDirectoryName);
		await mkdir(directory, { mode: 0o700 });
		await Promise.all([
			writeFile(join(directory, "report.json"), "stale report", { mode: 0o600 }),
			writeFile(join(directory, "failure.json"), "stale failure", { mode: 0o600 }),
		]);

		const result = runEntrypoint(root);

		expect(result.status).toBe(1);
		expect(result.signal).toBeNull();
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe(`${V2_CANARY_FAILURE_STDERR}\n`);
		expect((await stat(directory)).mode & 0o777).toBe(0o700);
		const failurePath = join(directory, "failure.json");
		expect((await stat(failurePath)).mode & 0o777).toBe(0o600);
		expect(JSON.parse(await readFile(failurePath, "utf8"))).toMatchObject({
			schemaVersion: 1,
			phase: "preflight",
			failure: "operator",
		});
		await expect(readFile(join(directory, "report.json"), "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	});

	test("surfaces a fixed nonzero failure when the private artifact destination cannot be prepared", async () => {
		const root = await mkdtemp(join(tmpdir(), "v2-canary-entrypoint-write-failure-test-"));
		temporaryDirectories.push(root);
		const directory = join(root, artifactDirectoryName);
		await mkdir(directory, { mode: 0o700 });
		await chmod(directory, 0o755);

		const result = runEntrypoint(root);

		expect(result.status).toBe(1);
		expect(result.signal).toBeNull();
		expect(result.stdout).toBe("");
		expect(result.stderr).toBe(`${V2_CANARY_ARTIFACT_WRITE_FAILURE_STDERR}\n`);
		await expect(readFile(join(directory, "failure.json"), "utf8")).rejects.toMatchObject({
			code: "ENOENT",
		});
	});
});
