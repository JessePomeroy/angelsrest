import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
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

test("resume fills interrupted outputs and preserves unrelated package changes", (t) => {
	const root = fixture(t);
	installWorkflow(root, example);
	const retained = readFileSync(join(root, "docs/client-integration.json"));
	const missing = ["scripts/client-integration/preflight.mjs", "docs/CLIENT_INTEGRATION.md"];
	for (const path of missing) unlinkSync(join(root, path));
	const packageJson = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
	delete packageJson.scripts["check:integration"];
	packageJson.scripts.custom = "node scripts/custom.mjs";
	writeFileSync(join(root, "package.json"), JSON.stringify(packageJson));
	const result = installWorkflow(root, example, { resume: true });
	assert.equal(result.resumed, true);
	assert.deepEqual(result.files.sort(), [...missing, "package.json"].sort());
	assert.ok(readFileSync(join(root, "docs/client-integration.json")).equals(retained));
	assert.equal(
		JSON.parse(readFileSync(join(root, "package.json"), "utf8")).scripts.custom,
		"node scripts/custom.mjs",
	);
	const before = readFileSync(join(root, "package.json"));
	assert.deepEqual(installWorkflow(root, example, { resume: true }).files, []);
	assert.ok(readFileSync(join(root, "package.json")).equals(before));
});

test("resume refuses changed evidence, tools, commands or symlinks before filling missing outputs", (t) => {
	for (const change of ["manifest", "tool", "command", "symlink"]) {
		const root = fixture(t);
		installWorkflow(root, example);
		const missing = join(root, "docs/CLIENT_INTEGRATION.md");
		unlinkSync(missing);
		const manifest = join(root, "docs/client-integration.json");
		if (change === "manifest") writeFileSync(manifest, "locally updated evidence");
		if (change === "tool")
			writeFileSync(join(root, "scripts/client-integration/plan.mjs"), "local changes");
		if (change === "command") {
			const data = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
			data.scripts["check:integration"] = "node scripts/other-gate.mjs";
			writeFileSync(join(root, "package.json"), JSON.stringify(data));
		}
		if (change === "symlink") {
			writeFileSync(join(root, "saved-manifest.json"), readFileSync(manifest));
			unlinkSync(manifest);
			symlinkSync(join(root, "saved-manifest.json"), manifest);
		}
		const before = readFileSync(join(root, "package.json"));
		const manifestBefore = readFileSync(manifest);
		assert.throws(() => installWorkflow(root, example, { resume: true }), /differs|already exists/);
		assert.equal(existsSync(missing), false);
		assert.ok(readFileSync(join(root, "package.json")).equals(before));
		assert.ok(readFileSync(manifest).equals(manifestBefore));
	}
});
