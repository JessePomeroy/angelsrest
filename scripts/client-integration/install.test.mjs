import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { installWorkflow } from "./install.mjs";

const example = JSON.parse(
	readFileSync(new URL("../../docs/examples/client-integration.json", import.meta.url), "utf8"),
);
const cli = fileURLToPath(new URL("../client-integration.mjs", import.meta.url));

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "client-integration-install-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "--quiet", root]);
	writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { test: "node --test" } }));
	return root;
}

test("a portable fresh installation starts pending and prints a read-only plan", (t) => {
	const root = fixture(t);
	const supplied = structuredClone(example);
	for (const stage of supplied.stages) stage.verification = { staging: { stale: true } };
	const installed = installWorkflow(root, supplied);
	assert.equal(installed.verification, "pending");
	const manifest = JSON.parse(readFileSync(join(root, "docs/client-integration.json"), "utf8"));
	assert.ok(
		manifest.stages.every(
			({ verification }) =>
				Object.keys(verification).length === 2 &&
				Object.values(verification).every((entry) => entry === null),
		),
	);
	const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	assert.equal(packageJson.scripts.test, "node --test");
	assert.equal(
		packageJson.scripts["check:integration"],
		"node scripts/client-integration.mjs check",
	);
	const env = { PATH: process.env.PATH };
	const plan = spawnSync(process.execPath, ["scripts/client-integration.mjs", "plan", "staging"], {
		cwd: root,
		env,
		encoding: "utf8",
	});
	assert.equal(plan.status, 0, plan.stderr);
	assert.equal(JSON.parse(plan.stdout).ready, false);
	const gate = spawnSync(process.execPath, ["scripts/client-integration.mjs", "check", "staging"], {
		cwd: root,
		env,
		encoding: "utf8",
	});
	assert.equal(gate.status, 1);
	assert.ok(JSON.parse(gate.stdout).issues.some((issue) => issue.includes("verification")));
	assert.throws(() => installWorkflow(root, example), /already exists/);
	assert.deepEqual(JSON.parse(readFileSync(join(root, "package.json"), "utf8")), packageJson);
});

test("existing files and escaping symlink parents stop installation before writes", (t) => {
	const root = fixture(t);
	mkdirSync(join(root, "docs"));
	writeFileSync(join(root, "docs/client-integration.json"), "existing evidence");
	const before = readFileSync(join(root, "package.json"), "utf8");
	assert.throws(() => installWorkflow(root, example), /target exists/);
	assert.equal(
		readFileSync(join(root, "docs/client-integration.json"), "utf8"),
		"existing evidence",
	);
	assert.equal(readFileSync(join(root, "package.json"), "utf8"), before);
	const second = fixture(t);
	const outside = mkdtempSync(join(tmpdir(), "client-integration-outside-"));
	t.after(() => rmSync(outside, { recursive: true, force: true }));
	symlinkSync(outside, join(second, "scripts"));
	assert.throws(() => installWorkflow(second, example), /symbolic links/);
	assert.equal(readFileSync(join(second, "package.json"), "utf8"), before);
});

test("CLI rejects a malformed contract without echoing input or contacting services", (t) => {
	const root = fixture(t);
	mkdirSync(join(root, "docs"));
	writeFileSync(join(root, "docs/client-integration.json"), '{"private":"DO_NOT_ECHO_SENTINEL"');
	const run = spawnSync(process.execPath, [cli, "plan", "staging"], {
		cwd: root,
		encoding: "utf8",
		env: { PATH: process.env.PATH },
	});
	assert.equal(run.status, 1);
	assert.doesNotMatch(run.stdout + run.stderr, /DO_NOT_ECHO_SENTINEL/);
});

test("invalid package manifest shapes fail before any installation writes", (t) => {
	for (const value of [[], null, "invalid", { scripts: [] }]) {
		const root = fixture(t);
		const original = JSON.stringify(value);
		writeFileSync(join(root, "package.json"), original);
		assert.throws(() => installWorkflow(root, example), /must.*object/);
		assert.equal(readFileSync(join(root, "package.json"), "utf8"), original);
		assert.equal(existsSync(join(root, "scripts")), false);
		assert.equal(existsSync(join(root, "docs")), false);
	}
});
