import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	createReleaseRecord,
	fingerprintPublicConfig,
} from "../../packages/crm-api/src/releases/records.mjs";
import { assessAdminAdoption } from "./adoption.mjs";

const revision = "a".repeat(40);
const at = (minute) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
function environment(
	environmentId,
	{
		source = revision,
		admin = "6.7.2",
		result = "passed",
		minute = 0,
		backend = "crm-api@6.7.0",
		target: providerTarget = environmentId === "production" ? "production" : "preview",
	} = {},
) {
	const publicOrigin = `https://${environmentId}.example.com`;
	const target = {
		repository: "example/site",
		siteUrl: "example.com",
		environmentId,
		publicOrigin,
		requiredChecks: [{ id: "http:/", scope: "public" }],
	};
	const identity = {
		repository: target.repository,
		siteUrl: target.siteUrl,
		environmentId,
		contractFingerprint: null,
	};
	const publicConfig = {
		publicOrigin,
		convexUrl: null,
		convexSiteUrl: null,
		cmsMediaOrigin: null,
		checkoutSnapshotMode: "handle-v2",
		mutationTransport: "http",
	};
	const build = createReleaseRecord({
		kind: "build",
		identity,
		observedAt: at(minute),
		data: {
			sourceRevision: source,
			sourceFingerprint: null,
			packages: [
				{ name: "@jessepomeroy/admin", version: admin, source: "installed" },
				{ name: "@jessepomeroy/crm-api", version: "6.7.0", source: "workspace" },
			],
			lockfileDigest: "b".repeat(64),
			scope: "ci-fixture",
			publicConfig,
			configFingerprint: fingerprintPublicConfig(publicConfig),
			requiredContracts: { backend: [backend], workers: [] },
			github: {
				runId: "123",
				runAttempt: 1,
				event: "workflow_dispatch",
				ref: "refs/heads/adoption",
				headSha: source,
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
				].map((id) => [id, "success"]),
			),
			output: { scope: "static-client-assets", digest: "c".repeat(64), fileCount: 1, bytes: 12 },
		},
	});
	const deployment = createReleaseRecord({
		kind: "deployment",
		identity,
		observedAt: at(minute + 1),
		data: {
			buildRecordId: build.recordId,
			provider: "vercel",
			accountId: "team_fixture",
			projectId: "prj_fixture",
			deploymentId: `dpl_${environmentId}${minute}`,
			url: "https://fixture.vercel.app",
			target: providerTarget,
			status: "READY",
			sourceRevision: source,
			configFingerprint: null,
			binding: "source-only",
			aliases: [{ hostname: new URL(publicOrigin).hostname, assigned: true }],
		},
	});
	const verification = createReleaseRecord({
		kind: "verification",
		identity,
		observedAt: at(minute + 2),
		data: {
			deploymentRecordId: deployment.recordId,
			configFingerprint: null,
			checks: [
				{
					id: "http:/",
					scope: "public",
					result,
					evidenceRef: "docs/integration-evidence/fixture.json",
				},
			],
		},
	});
	return { target, records: [build, deployment, verification] };
}
function input() {
	return {
		staging: environment("staging"),
		production: environment("production", { source: "d".repeat(40), admin: "6.7.1" }),
		candidateRevision: revision,
		version: "6.7.2",
	};
}

test("staging checks retain a separate production recovery reference and never prove runtime compatibility", () => {
	const result = assessAdminAdoption(input());
	assert.equal(result.evidenceReady, true);
	assert.equal(result.staging.release.sourceRevision, revision);
	assert.equal(result.production.release.sourceRevision, "d".repeat(40));
	assert.equal(result.rollback.release.deploymentId, "dpl_production0");
	assert.equal(result.runtimeRequirements, "unchanged");
	assert.equal(result.runtimeCompatibility, "unknown");
	assert.equal(result.rollback.providerAvailability, "unverified");
});

test("wrong source, version and latest unbound builds cannot satisfy the candidate gate", () => {
	for (const change of [{ source: "e".repeat(40) }, { admin: "6.7.1" }]) {
		const value = input();
		value.staging = environment("staging", change);
		value.staging.records.push(environment("staging", { minute: 10 }).records[0]);
		const result = assessAdminAdoption(value);
		assert.equal(result.evidenceReady, false);
		assert.equal(result.staging.status, "candidate-mismatch");
	}
});

test("failed, blocked and missing staging evidence cannot pass using an older healthy release", () => {
	for (const outcome of ["failed", "blocked"]) {
		const value = input();
		value.staging.records.push(...environment("staging", { minute: 10, result: outcome }).records);
		assert.equal(assessAdminAdoption(value).evidenceReady, false);
	}
	const missingCheck = input();
	missingCheck.staging.records.push(...environment("staging", { minute: 10 }).records.slice(0, 2));
	assert.equal(assessAdminAdoption(missingCheck).staging.status, "unknown");
	const value = input();
	value.staging.records = [];
	assert.equal(assessAdminAdoption(value).staging.status, "unknown");
});

test("changed runtime contracts require backend-first review and missing recovery proof remains missing", () => {
	const changed = input();
	changed.staging = environment("staging", { backend: "crm-api@7.0.0" });
	assert.equal(assessAdminAdoption(changed).nextAction, "review-backend-first-rollout");
	const missing = input();
	missing.production.records.pop();
	const result = assessAdminAdoption(missing);
	assert.equal(result.evidenceReady, false);
	assert.equal(result.rollback.release, null);
});

test("a failed production upgrade keeps the older scoped recovery reference", () => {
	const value = input();
	value.production.records.push(
		...environment("production", { minute: 10, result: "failed" }).records,
	);
	const result = assessAdminAdoption(value);
	assert.equal(result.production.verification.status, "failed");
	assert.equal(result.rollback.release.deploymentId, "dpl_production0");
});

test("environment, site, origin, policy and provider-target confusion is refused", () => {
	for (const change of [
		(value) => {
			value.staging = value.production;
		},
		(value) => {
			value.staging.target.siteUrl = "another.example.com";
		},
		(value) => {
			value.staging.target.publicOrigin = value.production.target.publicOrigin;
		},
		(value) => {
			value.staging.target.requiredChecks.push({ id: "http:/cart", scope: "public" });
		},
		(value) => {
			value.staging = environment("staging", { target: "production" });
		},
	]) {
		const value = input();
		change(value);
		assert.throws(() => assessAdminAdoption(value));
	}
});

test("the real CLI is offline, refuses missing evidence and does not write a history", (t) => {
	const root = mkdtempSync(join(tmpdir(), "adoption-cli-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "--quiet", root]);
	execFileSync("git", ["remote", "add", "origin", "https://github.com/example/site.git"], {
		cwd: root,
	});
	const script = fileURLToPath(new URL("../check-release-adoption.mjs", import.meta.url));
	const args = [
		script,
		"--repository",
		"example/site",
		"--site",
		"example.com",
		"--candidate",
		revision,
		"--version",
		"6.7.2",
		"--staging-origin",
		"https://staging.example.com",
		"--production-origin",
		"https://production.example.com",
		"--public-path",
		"/",
	];
	const result = spawnSync(process.execPath, args, { cwd: root, encoding: "utf8" });
	assert.equal(result.status, 1);
	assert.equal(result.stderr, "");
	assert.equal(JSON.parse(result.stdout).evidenceReady, false);
	assert.deepEqual(readdirSync(root), [".git"]);
});
