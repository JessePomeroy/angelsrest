import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	createReleaseRecord,
	fingerprintPublicConfig,
} from "../../packages/crm-api/src/releases/records.mjs";

const script = fileURLToPath(new URL("../import-release.mjs", import.meta.url));

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "release-import-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "--quiet", "--initial-branch=main", root]);
	execFileSync("git", ["remote", "add", "origin", "https://github.com/fixture/studio.git"], {
		cwd: root,
	});
	const folder = join(root, "docs/integration-evidence/releases/production");
	mkdirSync(folder, { recursive: true });
	const bin = join(root, "bin");
	mkdirSync(bin);
	const capture = join(root, "import-arguments.json");
	writeFileSync(
		join(bin, "pnpm"),
		`#!${process.execPath}\nrequire('node:fs').writeFileSync(process.env.IMPORT_CAPTURE_PATH, JSON.stringify(process.argv.slice(2))); console.log(JSON.stringify({changed:true,version:1}));\n`,
	);
	chmodSync(join(bin, "pnpm"), 0o700);
	const identity = {
		repository: "fixture/studio",
		siteUrl: "studio.example",
		environmentId: "production",
		contractFingerprint: null,
	};
	const packages = [
		{ name: "@jessepomeroy/admin", version: "1.0.0", source: "installed" },
		{ name: "@jessepomeroy/crm-api", version: "1.0.0", source: "installed" },
	];
	const intended = createReleaseRecord({
		kind: "intended",
		identity,
		observedAt: "2026-01-01T00:00:00.000Z",
		data: {
			sourceRevision: null,
			packages,
			requiredContracts: { backend: [], workers: [] },
			reviewRef: "https://github.com/fixture/studio/pull/1",
			capabilities: Object.fromEntries(
				[
					"portfolio",
					"sitePages",
					"blog",
					"catalog",
					"privateCatalogAssets",
					"crm",
					"delivery",
					"commerce",
				].map((name) => [name, "excluded"]),
			),
		},
	});
	const save = (record) => {
		const name = `${record.recordId.slice(7)}.json`;
		writeFileSync(join(folder, name), JSON.stringify(record));
		return name;
	};
	const intendedName = save(intended);
	const base = [
		"--repository",
		identity.repository,
		"--site",
		identity.siteUrl,
		"--environment",
		identity.environmentId,
		"--origin",
		"https://studio.example",
		"--convex-deployment",
		"prod",
		"--public-path",
		"/",
	];
	const run = (args) =>
		spawnSync(process.execPath, [script, ...args], {
			cwd: root,
			encoding: "utf8",
			env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, IMPORT_CAPTURE_PATH: capture },
		});
	return { root, folder, capture, identity, packages, intendedName, base, run, save };
}

test("operator import sends only the selected reviewed intention to the explicit internal action", (t) => {
	const f = fixture(t);
	const result = f.run([...f.base, "--record", f.intendedName]);
	assert.equal(result.status, 0, result.stderr);
	const args = JSON.parse(readFileSync(f.capture));
	assert.deepEqual(args.slice(0, 6), [
		"--filter",
		"@jessepomeroy/crm-api",
		"exec",
		"convex",
		"run",
		"platformReleaseRecordsNode:importObservation",
	]);
	assert.deepEqual(args.slice(7), ["--deployment", "prod", "--codegen", "disable"]);
	assert(!args.includes("--push"));
	const payload = JSON.parse(args[6]);
	assert.deepEqual(payload.target.requiredChecks, [{ id: "http:/", scope: "public" }]);
	const evidence = JSON.parse(payload.evidenceJson);
	assert.equal(evidence.records.length, 1);
	assert.equal(evidence.records[0].kind, "intended");
	assert.deepEqual(evidence.receipts, []);
	assert.deepEqual(JSON.parse(result.stdout), { changed: true, version: 1 });
});

test("an observation import includes its complete proof and leaves unrelated intent out", (t) => {
	const f = fixture(t);
	const observedAt = "2026-01-01T00:00:01.000Z";
	const publicConfig = {
		publicOrigin: "https://studio.example",
		convexUrl: null,
		convexSiteUrl: null,
		cmsMediaOrigin: null,
		checkoutSnapshotMode: null,
		mutationTransport: "http",
	};
	const sourceRevision = "a".repeat(40);
	const build = createReleaseRecord({
		kind: "build",
		identity: f.identity,
		observedAt: "2026-01-01T00:00:00.000Z",
		data: {
			sourceRevision,
			sourceFingerprint: null,
			packages: f.packages,
			lockfileDigest: "b".repeat(64),
			scope: "ci-fixture",
			publicConfig,
			configFingerprint: fingerprintPublicConfig(publicConfig),
			requiredContracts: { backend: [], workers: [] },
			github: {
				runId: "7",
				runAttempt: 1,
				event: "push",
				ref: "refs/heads/main",
				headSha: sourceRevision,
				workflow: ".github/workflows/ci.yml",
			},
			checks: Object.fromEntries(
				[
					"dependency_install",
					"worker_checkout",
					"worker_install",
					"lint",
					"typecheck",
					"tests",
					"retired_checkout",
					"build",
					"component_browser",
					"e2e",
				].map((name) => [name, "success"]),
			),
			output: { scope: "static-client-assets", digest: "c".repeat(64), fileCount: 1, bytes: 100 },
		},
	});
	const deployment = createReleaseRecord({
		kind: "deployment",
		identity: f.identity,
		observedAt,
		data: {
			buildRecordId: build.recordId,
			provider: "vercel",
			accountId: "team_fixture",
			projectId: "prj_fixture",
			deploymentId: "dpl_fixture",
			url: "https://fixture.vercel.app",
			target: "production",
			status: "READY",
			sourceRevision,
			configFingerprint: null,
			binding: "source-only",
			aliases: [{ hostname: "studio.example", assigned: true }],
		},
	});
	const receipt = {
		version: 1,
		observedAt,
		buildRecordId: build.recordId,
		deploymentRecordId: deployment.recordId,
		artifact: {
			id: "11",
			digest: `sha256:${"e".repeat(64)}`,
			bytes: 1000,
			runId: "7",
			runAttempt: 1,
			url: "https://github.com/fixture/studio/actions/runs/7/artifacts/11",
		},
		provider: {
			accountId: "team_fixture",
			projectId: "prj_fixture",
			deploymentId: "dpl_fixture",
			aliasStableDuringChecks: true,
		},
		publicChecks: [{ path: "/", status: 200, html: true, result: "passed" }],
	};
	const receiptName = `observation-${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}.json`;
	const verification = createReleaseRecord({
		kind: "verification",
		identity: f.identity,
		observedAt,
		data: {
			deploymentRecordId: deployment.recordId,
			configFingerprint: null,
			checks: [
				{
					id: "http:/",
					scope: "public",
					result: "passed",
					evidenceRef: `docs/integration-evidence/releases/production/${receiptName}`,
				},
			],
		},
	});
	for (const record of [build, deployment, verification]) f.save(record);
	writeFileSync(join(f.folder, receiptName), JSON.stringify(receipt));
	const result = f.run([...f.base, "--receipt", receiptName]);
	assert.equal(result.status, 0, result.stderr);
	const args = JSON.parse(readFileSync(f.capture));
	const evidence = JSON.parse(JSON.parse(args[6]).evidenceJson);
	assert.deepEqual(evidence.records.map((record) => record.kind).sort(), [
		"build",
		"deployment",
		"verification",
	]);
	assert.deepEqual(evidence.receipts, [{ name: receiptName, value: receipt }]);
});

test("missing policy, conflicting selectors and unknown receipts cannot invoke the backend", (t) => {
	const f = fixture(t);
	for (const args of [
		[...f.base.slice(0, -2), "--record", f.intendedName],
		[...f.base, "--record", f.intendedName, "--receipt", "observation-missing.json"],
		[...f.base, "--receipt", "../private.json"],
		[...f.base, "--record", f.intendedName, "--push", "true"],
	]) {
		const result = f.run(args);
		assert.equal(result.status, 1);
		assert(!existsSync(f.capture));
	}
});

test("a different Git repository cannot import local evidence into the selected platform", (t) => {
	const f = fixture(t);
	execFileSync("git", ["remote", "set-url", "origin", "https://github.com/foreign/studio.git"], {
		cwd: f.root,
	});
	const result = f.run([...f.base, "--record", f.intendedName]);
	assert.equal(result.status, 1);
	assert(!existsSync(f.capture));
	assert(!result.stderr.includes(resolve(f.root)));
});
