import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { readReleaseHistory, retainReleaseObservation } from "./history.mjs";
import { authenticatedReaders, observeRelease, publicProbe, statusTarget } from "./observe.mjs";
import { createReleaseRecord, deriveReleaseStatus, fingerprintPublicConfig } from "./records.mjs";

const target = {
	repository: "example/site",
	siteUrl: "example.com",
	environmentId: "production",
	publicOrigin: "https://www.example.com",
	artifactId: "42",
	deploymentId: "dpl_current",
	teamId: "team_owner",
	projectId: "prj_site",
	target: "production",
	workflow: ".github/workflows/ci.yml",
	publicPaths: ["/", "/cart"],
};
function zip(entries) {
	return execFileSync(
		"python3",
		[
			"-c",
			`
import io, json, sys, zipfile
output = io.BytesIO()
with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
    for name, body in json.load(sys.stdin):
        archive.writestr(name, body)
sys.stdout.buffer.write(output.getvalue())
`,
		],
		{ input: JSON.stringify(entries), maxBuffer: 2 * 1024 * 1024 },
	);
}
function fixture(sourceRevision = "a".repeat(40)) {
	const publicConfig = {
		publicOrigin: target.publicOrigin,
		convexUrl: null,
		convexSiteUrl: null,
		cmsMediaOrigin: null,
		checkoutSnapshotMode: null,
		mutationTransport: "http",
	};
	const build = createReleaseRecord({
		kind: "build",
		identity: {
			repository: target.repository,
			siteUrl: target.siteUrl,
			environmentId: target.environmentId,
			contractFingerprint: null,
		},
		observedAt: new Date(Date.now() - 1000).toISOString(),
		data: {
			sourceRevision,
			sourceFingerprint: null,
			packages: ["admin", "crm-api"].map((name) => ({
				name: `@jessepomeroy/${name}`,
				version: "6.6.0",
				source: "installed",
			})),
			lockfileDigest: "b".repeat(64),
			scope: "ci-fixture",
			publicConfig,
			configFingerprint: fingerprintPublicConfig(publicConfig),
			requiredContracts: { backend: [], workers: [] },
			github: {
				runId: "123",
				runAttempt: 1,
				event: "push",
				ref: "refs/heads/main",
				headSha: sourceRevision,
				workflow: target.workflow,
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
				].map((id) => [id, "success"]),
			),
			output: { scope: "static-client-assets", digest: "c".repeat(64), fileCount: 1, bytes: 80 },
		},
	});
	const archive = zip([["build.json", JSON.stringify(build)]]);
	const metadata = {
		id: 42,
		expired: false,
		expires_at: new Date(Date.now() + 86400000).toISOString(),
		size_in_bytes: archive.length,
		digest: `sha256:${createHash("sha256").update(archive).digest("hex")}`,
		name: `release-record-8-${sourceRevision}-123-1`,
		workflow_run: { id: 123, repository_id: 8, head_repository_id: 8, head_sha: sourceRevision },
	};
	const run = {
		id: 123,
		run_attempt: 1,
		status: "completed",
		conclusion: "success",
		path: target.workflow,
		event: "push",
		head_sha: sourceRevision,
		repository: { id: 8, full_name: target.repository },
		head_repository: { id: 8 },
	};
	const provider = {
		id: target.deploymentId,
		ownerId: target.teamId,
		projectId: target.projectId,
		target: "production",
		readyState: "READY",
		url: "site-immutable.vercel.app",
		meta: {
			githubCommitOrg: "example",
			githubCommitRepo: "site",
			githubCommitSha: sourceRevision,
			private: "DO-NOT-RETAIN",
		},
		gitSource: { type: "github", sha: sourceRevision, repoId: 8 },
		env: ["DO-NOT-RETAIN"],
	};
	const alias = {
		alias: "www.example.com",
		projectId: target.projectId,
		deploymentId: target.deploymentId,
		redirect: null,
	};
	const calls = [];
	const readers = {
		github: async (path, binary) => {
			calls.push(["github", path, binary ?? false]);
			if (path.endsWith("/zip")) return archive;
			if (path.includes("/attempts/")) return run;
			return metadata;
		},
		vercel: async (path) => {
			calls.push(["vercel", path]);
			return path.startsWith("/v13/") ? provider : alias;
		},
		archive: authenticatedReaders().archive,
	};
	const probe = async (_origin, path) => ({ path, status: 200, html: true, result: "passed" });
	return { build, archive, metadata, run, provider, alias, readers, probe, calls };
}

test("authenticated source binding retains scoped proof without provider secrets or production config claims", async () => {
	const f = fixture();
	const observed = await observeRelease(target, f.readers, f.probe);
	const status = deriveReleaseStatus(observed.records, statusTarget(target));
	assert.equal(status.lastHealthy.data.deploymentId, target.deploymentId);
	assert.equal(status.currentDeployment.data.binding, "source-only");
	assert.equal(status.currentDeployment.data.configFingerprint, null);
	assert.equal(status.capabilities, null);
	assert.equal(status.build.data.scope, "ci-fixture");
	assert.equal(observed.receipt.artifact.digest, f.metadata.digest);
	assert.equal(JSON.stringify(observed).includes("DO-NOT-RETAIN"), false);
	assert.equal(
		f.calls.filter(([provider, path]) => provider === "vercel" && path.startsWith("/v4/")).length,
		2,
	);
});

test("wrong artifact identity, expiration, bytes, run or repository cannot create deployment evidence", async () => {
	for (const change of [
		(f) => {
			f.metadata.expired = true;
		},
		(f) => {
			f.metadata.digest = `sha256:${"0".repeat(64)}`;
		},
		(f) => {
			f.metadata.id = 99;
		},
		(f) => {
			f.metadata.name += "-other";
		},
		(f) => {
			f.metadata.workflow_run.head_repository_id = 7;
		},
		(f) => {
			f.run.run_attempt = 2;
		},
		(f) => {
			f.run.conclusion = "failure";
		},
		(f) => {
			f.run.path = ".github/workflows/other.yml";
		},
		(f) => {
			f.run.repository.full_name = "other/site";
		},
		(f) => {
			f.run.head_sha = "d".repeat(40);
		},
	]) {
		const f = fixture();
		change(f);
		await assert.rejects(observeRelease(target, f.readers, f.probe));
		assert.equal(
			f.calls.some(([provider]) => provider === "vercel"),
			false,
		);
	}
});

test("provider team, project, repository, exact source and environment must agree", async () => {
	for (const change of [
		(f) => {
			f.provider.ownerId = "team_other";
		},
		(f) => {
			f.provider.projectId = "prj_other";
		},
		(f) => {
			f.provider.meta.githubCommitRepo = "other";
		},
		(f) => {
			f.provider.meta.githubCommitSha = "f".repeat(40);
		},
		(f) => {
			f.provider.gitSource.repoId = 7;
		},
		(f) => {
			f.provider.gitSource.sha = "f".repeat(40);
		},
		(f) => {
			f.provider.target = null;
		},
		(f) => {
			f.provider.url = "attacker.example.com";
		},
	]) {
		const f = fixture();
		change(f);
		await assert.rejects(observeRelease(target, f.readers, f.probe));
	}
});

test("an alias change during HTTP checks blocks health and removes current assignment", async () => {
	const f = fixture();
	const observed = await observeRelease(target, f.readers, async (origin, path) => {
		f.alias.deploymentId = "dpl_new";
		return f.probe(origin, path);
	});
	const status = deriveReleaseStatus(observed.records, statusTarget(target));
	assert.equal(status.currentDeployment, null);
	assert.equal(status.lastHealthy, null);
	assert.ok(observed.records[2].data.checks.every((check) => check.result === "blocked"));
});

test("unresolved aliases never trigger public probes or infer assignment", async () => {
	const f = fixture();
	f.alias.projectId = "prj_other";
	const observed = await observeRelease(target, f.readers, () => assert.fail("must not probe"));
	assert.equal(observed.records[1].data.aliases[0].assigned, null);
	assert.equal(deriveReleaseStatus(observed.records, statusTarget(target)).lastHealthy, null);
});

test("retained history is idempotent and keeps a healthy rollback through a failed upgrade", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
	const root = mkdtempSync(join(tmpdir(), "release-history-"));
	const good = fixture();
	const initial = await observeRelease(target, good.readers, good.probe);
	retainReleaseObservation(root, target, initial);
	const directory = join(root, "docs/integration-evidence/releases/production");
	const before = readdirSync(directory).map((name) => [
		name,
		readFileSync(join(directory, name), "utf8"),
	]);
	retainReleaseObservation(root, target, initial);
	assert.deepEqual(
		readdirSync(directory).map((name) => [name, readFileSync(join(directory, name), "utf8")]),
		before,
	);
	t.mock.timers.tick(2000);
	const bad = fixture("d".repeat(40));
	bad.provider.id = "dpl_failed";
	bad.provider.readyState = "ERROR";
	const failed = await observeRelease({ ...target, deploymentId: "dpl_failed" }, bad.readers, () =>
		assert.fail("must not probe"),
	);
	const status = retainReleaseObservation(root, target, failed);
	assert.equal(status.lastHealthy.data.deploymentId, target.deploymentId);
	assert.equal(status.latestDeployment.data.deploymentId, "dpl_failed");
	assert.equal(status.latestDeployment.data.status, "ERROR");
	assert.equal(readReleaseHistory(root, target).length, 6);
	for (const [name, bytes] of before)
		assert.equal(readFileSync(join(directory, name), "utf8"), bytes);
});

test("history refuses linked directories and immutable-file conflicts", async () => {
	const root = mkdtempSync(join(tmpdir(), "release-linked-"));
	const outside = mkdtempSync(join(tmpdir(), "release-outside-"));
	mkdirSync(join(root, "docs"));
	symlinkSync(outside, join(root, "docs/integration-evidence"));
	const f = fixture();
	const observation = await observeRelease(target, f.readers, f.probe);
	assert.throws(() => retainReleaseObservation(root, target, observation));
	assert.deepEqual(readdirSync(outside), []);
	const clean = mkdtempSync(join(tmpdir(), "release-conflict-"));
	retainReleaseObservation(clean, target, observation);
	const path = join(
		clean,
		"docs/integration-evidence/releases/production",
		observation.receiptName,
	);
	writeFileSync(path, "existing proof\n");
	assert.throws(() => retainReleaseObservation(clean, target, observation));
	assert.equal(readFileSync(path, "utf8"), "existing proof\n");
});

test("archive reader rejects path traversal, extra files and oversized contents without extraction", () => {
	for (const entries of [
		[["../build.json", "{}"]],
		[
			["build.json", "{}"],
			["unexpected.json", "{}"],
		],
		[["build.json", "x".repeat(256 * 1024 + 1)]],
	])
		assert.throws(() => authenticatedReaders().archive(zip(entries)));
});

test("public probes never follow redirects, retain bodies or use credentials", async () => {
	let cancelled = false;
	const result = await publicProbe(target.publicOrigin, "/", async (url, options) => {
		assert.equal(url, `${target.publicOrigin}/`);
		assert.equal(options.redirect, "manual");
		assert.equal(options.credentials, "omit");
		return {
			status: 302,
			headers: new Headers({ "content-type": "text/html" }),
			body: {
				cancel: async () => {
					cancelled = true;
				},
			},
		};
	});
	assert.equal(result.result, "blocked");
	assert.equal(cancelled, true);
	assert.equal(
		(
			await publicProbe(target.publicOrigin, "/", async () => {
				throw new Error("PRIVATE");
			})
		).result,
		"blocked",
	);
});

test("actual CLI uses authenticated GET commands, retains records and reads status offline without secret output", () => {
	const root = mkdtempSync(join(tmpdir(), "release-cli-"));
	const bin = join(root, "bin");
	mkdirSync(bin);
	execFileSync("git", ["init", "--quiet", root]);
	execFileSync("git", [
		"-C",
		root,
		"remote",
		"add",
		"origin",
		"https://github.com/example/site.git",
	]);
	const f = fixture();
	const fixturePath = join(root, "fixture.json");
	writeFileSync(
		fixturePath,
		JSON.stringify({
			metadata: f.metadata,
			run: f.run,
			provider: f.provider,
			alias: f.alias,
			archive: f.archive.toString("base64"),
		}),
	);
	const callsPath = join(root, "calls.jsonl");
	for (const program of ["gh", "vercel"]) {
		writeFileSync(
			join(bin, program),
			`#!/usr/bin/env node
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(callsPath)}, JSON.stringify(args) + '\\n');
if (process.env.RELEASE_TEST_FAIL === '1') { process.stderr.write('DO-NOT-RETAIN'); process.exit(1); }
if (args[args.indexOf('--method') + 1] !== 'GET') process.exit(2);
const fixture = JSON.parse(fs.readFileSync(${JSON.stringify(fixturePath)}, 'utf8'));
const path = args.find(value => value.startsWith('/'));
if (path.endsWith('/zip')) process.stdout.write(Buffer.from(fixture.archive, 'base64'));
else process.stdout.write(JSON.stringify(path.startsWith('/v13/') ? fixture.provider : path.startsWith('/v4/') ? fixture.alias : path.includes('/attempts/') ? fixture.run : fixture.metadata));
`,
			{ mode: 0o755 },
		);
	}
	const identityArgs = [
		"--repository",
		target.repository,
		"--site",
		target.siteUrl,
		"--environment",
		target.environmentId,
		"--origin",
		target.publicOrigin,
	];
	const args = [
		"--artifact",
		target.artifactId,
		"--deployment",
		target.deploymentId,
		"--team",
		target.teamId,
		"--project",
		target.projectId,
		"--target",
		"production",
		...identityArgs,
	];
	const entry = fileURLToPath(new URL("../observe-release.mjs", import.meta.url));
	const options = {
		cwd: root,
		encoding: "utf8",
		env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
	};
	const observed = spawnSync(process.execPath, [entry, "observe", ...args], options);
	assert.equal(observed.status, 0, observed.stderr);
	assert.equal(observed.stdout.includes("DO-NOT-RETAIN"), false);
	assert.equal(
		JSON.parse(observed.stdout).currentDeployment.data.deploymentId,
		target.deploymentId,
	);
	assert.equal(JSON.parse(observed.stdout).lastHealthy, null);
	const beforeCalls = readFileSync(callsPath, "utf8");
	const status = spawnSync(process.execPath, [entry, "status", ...identityArgs], {
		...options,
		env: { ...options.env, RELEASE_TEST_FAIL: "1" },
	});
	assert.equal(status.status, 0, status.stderr);
	assert.equal(readFileSync(callsPath, "utf8"), beforeCalls);
	const failed = spawnSync(process.execPath, [entry, "observe", ...args], {
		...options,
		env: { ...options.env, RELEASE_TEST_FAIL: "1" },
	});
	assert.equal(failed.status, 1);
	assert.equal(`${failed.stdout}${failed.stderr}`.includes("DO-NOT-RETAIN"), false);
	assert.equal(readReleaseHistory(root, target).length, 2);
});

test("a self-consistent artifact cannot substitute another source for an authenticated run or a PR merge", async () => {
	for (const event of ["push", "pull_request"]) {
		const f = fixture();
		const revised = createReleaseRecord({
			kind: "build",
			identity: f.build.identity,
			observedAt: f.build.observedAt,
			data: { ...f.build.data, github: { ...f.build.data.github, event, headSha: "b".repeat(40) } },
		});
		const bytes = zip([["build.json", JSON.stringify(revised)]]);
		f.metadata.size_in_bytes = bytes.length;
		f.metadata.digest = `sha256:${createHash("sha256").update(bytes).digest("hex")}`;
		f.metadata.workflow_run.head_sha = "b".repeat(40);
		f.run.head_sha = "b".repeat(40);
		f.run.event = event;
		const github = f.readers.github;
		f.readers.github = (path, binary) => (binary ? bytes : github(path, binary));
		await assert.rejects(observeRelease(target, f.readers, f.probe));
		assert.equal(
			f.calls.some(([provider]) => provider === "vercel"),
			false,
		);
	}
	const f = fixture();
	await assert.rejects(observeRelease({ ...target, target: "preview" }, f.readers, f.probe));
	assert.equal(f.calls.length, 0);
});

test("missing, corrupt or linked receipts prevent retained health claims", async () => {
	for (const defect of ["missing", "corrupt", "linked"]) {
		const root = mkdtempSync(join(tmpdir(), "release-receipt-"));
		const f = fixture();
		const observation = await observeRelease(target, f.readers, f.probe);
		retainReleaseObservation(root, target, observation);
		const path = join(
			root,
			"docs/integration-evidence/releases/production",
			observation.receiptName,
		);
		if (defect === "corrupt") writeFileSync(path, "{broken");
		else {
			unlinkSync(path);
			if (defect === "linked") {
				const outside = join(root, "outside.json");
				writeFileSync(outside, JSON.stringify(observation.receipt));
				symlinkSync(outside, path);
			}
		}
		assert.throws(() => readReleaseHistory(root, target));
	}
});

test("receipt content IDs do not permit unrelated probe proof to satisfy verification", async () => {
	const root = mkdtempSync(join(tmpdir(), "release-proof-"));
	const f = fixture();
	const observation = await observeRelease(target, f.readers, f.probe);
	observation.receipt.publicChecks[0].result = "blocked";
	observation.receiptName = `observation-${createHash("sha256").update(JSON.stringify(observation.receipt)).digest("hex")}.json`;
	assert.throws(() => retainReleaseObservation(root, target, observation));
	assert.deepEqual(readdirSync(root), []);
});

test("process interruption during publication leaves a complete orphan receipt and readable old rollback proof", async (t) => {
	t.mock.timers.enable({ apis: ["Date"], now: Date.now() });
	const root = mkdtempSync(join(tmpdir(), "release-interrupted-"));
	const f = fixture();
	const initial = await observeRelease(target, f.readers, f.probe);
	retainReleaseObservation(root, target, initial);
	t.mock.timers.tick(2000);
	const next = fixture("d".repeat(40));
	next.provider.id = "dpl_next";
	next.alias.deploymentId = "dpl_next";
	const observation = await observeRelease(
		{ ...target, deploymentId: "dpl_next" },
		next.readers,
		next.probe,
	);
	const payload = join(root, "next.json");
	writeFileSync(payload, JSON.stringify({ target, observation }));
	const result = spawnSync(
		process.execPath,
		[
			"--input-type=module",
			"-e",
			`
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
const original = fs.writeFileSync; let writes = 0;
fs.writeFileSync = (path, data, options) => {
  if (typeof path === 'number' && ++writes === 2) {
    original(path, '{partial'); process.exit(42);
  }
  return original(path, data, options);
};
syncBuiltinESMExports();
const { retainReleaseObservation } = await import(${JSON.stringify(new URL("./history.mjs", import.meta.url).href)});
const { target, observation } = JSON.parse(fs.readFileSync(${JSON.stringify(payload)}, 'utf8'));
retainReleaseObservation(${JSON.stringify(root)}, target, observation);
`,
		],
		{ encoding: "utf8" },
	);
	assert.equal(result.status, 42, result.stderr);
	const directory = join(root, "docs/integration-evidence/releases/production");
	assert.equal(readdirSync(directory).filter((name) => name.startsWith(".pending-")).length, 1);
	assert.equal(readdirSync(directory).filter((name) => name.startsWith("observation-")).length, 2);
	const interrupted = deriveReleaseStatus(readReleaseHistory(root, target), statusTarget(target));
	assert.equal(interrupted.lastHealthy.data.deploymentId, target.deploymentId);
	assert.equal(interrupted.currentDeployment.data.deploymentId, target.deploymentId);
	const resumed = retainReleaseObservation(root, target, observation);
	assert.equal(resumed.lastHealthy.data.deploymentId, "dpl_next");
});
