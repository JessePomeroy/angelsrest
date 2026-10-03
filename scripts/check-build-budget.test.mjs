import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { checkBudget, measureBuild } from "./check-build-budget.mjs";

const functionConfig = JSON.stringify({ runtime: "nodejs24.x", handler: "index.js" });

function fixture(t) {
	const cwd = mkdtempSync(join(tmpdir(), "angelsrest-build-budget-"));
	t.after(() => rmSync(cwd, { recursive: true, force: true }));
	const output = join(cwd, ".vercel/output");
	function write(path, content) {
		const file = join(output, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, content);
	}
	function bundle(name) {
		write(`functions/${name}.func/.vc-config.json`, functionConfig);
		write(`functions/${name}.func/index.js`, "hello");
	}
	write("config.json", '{"version":3}');
	write("static/app.js", "static");
	bundle("actual");
	return { cwd, output, write, bundle };
}

test("deduplicates function route aliases but counts linked dependencies in each bundle", (t) => {
	const f = fixture(t);
	f.bundle("second");
	f.write("shared/library.js", "dependency");
	symlinkSync("actual.func", join(f.output, "functions/alias.func"));
	for (const name of ["actual", "second"])
		symlinkSync("../../shared", join(f.output, `functions/${name}.func/dependency`));
	const result = measureBuild(f.output);
	const bundleBytes = Buffer.byteLength(functionConfig) + 5 + 10;
	assert.deepEqual(result.metrics, {
		functionCount: 2,
		functionBytes: bundleBytes * 2,
		largestFunctionBytes: bundleBytes,
		staticBytes: 6,
	});
	assert.equal(result.functions.length, 2);
});

test("each budget fails above its limit, but equality passes", (t) => {
	const result = measureBuild(fixture(t).output);
	const budget = {
		runtime: "nodejs24.x",
		baseline: { ...result.metrics },
		limits: { ...result.metrics },
	};
	assert.deepEqual(checkBudget(result, budget), []);
	for (const key of Object.keys(result.metrics)) {
		const over = { ...result, metrics: { ...result.metrics, [key]: result.metrics[key] + 1 } };
		assert.equal(checkBudget(over, budget).length, 1, key);
		assert.match(checkBudget(over, budget)[0], new RegExp(key));
	}
	assert.match(checkBudget(result, { ...budget, runtime: "nodejs22.x" })[0], /runtime/);
});

test("invalid or partial budgets cannot silently disable a limit", (t) => {
	const result = measureBuild(fixture(t).output);
	const budget = { runtime: "nodejs24.x", baseline: result.metrics, limits: result.metrics };
	for (const limits of [
		{},
		{ ...result.metrics, functionBytes: null },
		{ ...result.metrics, functionBytes: -1 },
		{ ...result.metrics, functionBytes: "100" },
		{ ...result.metrics, extra: 1 },
		{ ...result.metrics, staticBytes: 1 },
	])
		assert.throws(() => checkBudget(result, { ...budget, limits }), /[Bb]udget/);
});

test("missing, empty, or incompatible output fails closed", (t) => {
	const f = fixture(t);
	assert.throws(() => measureBuild(join(f.cwd, "missing")), /ENOENT/);
	f.write("config.json", '{"version":2}');
	assert.throws(() => measureBuild(f.output), /version 3/);
	f.write("config.json", '{"version":3}');
	f.write("static/app.js", "");
	assert.throws(() => measureBuild(f.output), /Static build output is empty/);
	rmSync(join(f.output, "functions/actual.func"), { recursive: true });
	assert.throws(() => measureBuild(f.output), /No function bundles/);
});

test("broken function aliases, broken dependency links, and link cycles fail", (t) => {
	for (const path of ["functions/broken.func", "functions/actual.func/broken"]) {
		const f = fixture(t);
		symlinkSync("missing", join(f.output, path));
		assert.throws(() => measureBuild(f.output), /ENOENT/);
	}
	for (const path of ["functions/loop", "functions/actual.func/loop", "static/loop"]) {
		const f = fixture(t);
		symlinkSync(".", join(f.output, path));
		assert.throws(() => measureBuild(f.output), /Directory cycle/);
	}
});

test("function configuration and handler must exist", (t) => {
	const f = fixture(t);
	f.write("functions/actual.func/.vc-config.json", '{"handler":"index.js"}');
	assert.throws(() => measureBuild(f.output), /Missing runtime/);
	f.write("functions/actual.func/.vc-config.json", functionConfig);
	rmSync(join(f.output, "functions/actual.func/index.js"));
	assert.throws(() => measureBuild(f.output), /ENOENT/);
});

test("CLI returns success for measured output and failure for growth or missing output", (t) => {
	const f = fixture(t);
	const script = fileURLToPath(new URL("./check-build-budget.mjs", import.meta.url));
	const run = (...args) =>
		spawnSync(process.execPath, [script, ...args], { cwd: f.cwd, encoding: "utf8" });
	const passing = run("--json");
	assert.equal(passing.status, 0, passing.stderr);
	assert.equal(JSON.parse(passing.stdout).metrics.functionCount, 1);
	for (let i = 0; i < 6; i++) f.bundle(`extra-${i}`);
	const failing = run("--json");
	assert.equal(failing.status, 1);
	assert.match(JSON.parse(failing.stdout).failures[0], /functionCount/);
	rmSync(f.output, { recursive: true });
	assert.equal(run().status, 1);
});
