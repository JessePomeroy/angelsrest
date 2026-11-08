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
		accountId = "team_fixture",
		projectId = "prj_fixture",
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
			accountId,
			projectId,
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

const providerProjects = {
	teamId: "team_fixture",
	stagingProjectId: "prj_stagingFixture",
	productionProjectId: "prj_productionFixture",
};
function isolatedInput() {
	return {
		...input(),
		staging: environment("staging", {
			target: "production",
			projectId: providerProjects.stagingProjectId,
		}),
		production: environment("production", {
			source: "d".repeat(40),
			admin: "6.7.1",
			projectId: providerProjects.productionProjectId,
		}),
		providerProjects,
	};
}

test("explicit distinct projects allow isolated production-target staging without relabeling evidence", () => {
	const value = isolatedInput();
	const result = assessAdminAdoption(value);
	assert.equal(result.evidenceReady, true);
	assert.deepEqual(result.providerProjects, providerProjects);
	assert.equal(value.staging.records[1].data.target, "production");
	assert.equal(result.runtimeCompatibility, "unknown");
	assert.equal(result.rollback.providerAvailability, "unverified");
});

test("isolated staging requires an explicit complete policy with different project identities", () => {
	for (const policy of [
		undefined,
		null,
		{ teamId: "team_fixture" },
		{ ...providerProjects, stagingProjectId: providerProjects.productionProjectId },
		{ ...providerProjects, teamId: "not-a-team" },
		{ ...providerProjects, stagingProjectId: "not-a-project" },
		{ ...providerProjects, allowUnverified: true },
	]) {
		assert.throws(() => assessAdminAdoption({ ...isolatedInput(), providerProjects: policy }));
	}
});

test("configured project and account identity are enforced for staging, current production and recovery", () => {
	for (const changed of [{ projectId: "prj_wrong" }, { accountId: "team_wrong" }]) {
		const stage = isolatedInput();
		stage.staging = environment("staging", {
			target: "production",
			projectId: providerProjects.stagingProjectId,
			...changed,
		});
		assert.throws(() => assessAdminAdoption(stage));
		const current = isolatedInput();
		current.production.records.push(
			...environment("production", {
				minute: 10,
				result: "failed",
				projectId: providerProjects.productionProjectId,
				...changed,
			}).records,
		);
		assert.throws(() => assessAdminAdoption(current));
		const recovery = isolatedInput();
		recovery.production = environment("production", {
			projectId: providerProjects.productionProjectId,
			...changed,
		});
		recovery.production.records.push(
			...environment("production", {
				minute: 10,
				result: "failed",
				projectId: providerProjects.productionProjectId,
			}).records,
		);
		assert.throws(() => assessAdminAdoption(recovery));
	}
});

test("isolated project policy retains candidate, health, contract and recovery requirements", () => {
	for (const change of [
		{ source: "e".repeat(40) },
		{ admin: "6.7.1" },
		{ result: "failed" },
		{ result: "blocked" },
		{ backend: "crm-api@7.0.0" },
	]) {
		const value = isolatedInput();
		value.staging = environment("staging", {
			target: "production",
			projectId: providerProjects.stagingProjectId,
			...change,
		});
		assert.equal(assessAdminAdoption(value).evidenceReady, false);
	}
	const missingRecovery = isolatedInput();
	missingRecovery.production.records.pop();
	assert.throws(() => assessAdminAdoption(missingRecovery));
	const wrongProductionTarget = isolatedInput();
	wrongProductionTarget.production = environment("production", {
		target: "preview",
		projectId: providerProjects.productionProjectId,
	});
	assert.throws(() => assessAdminAdoption(wrongProductionTarget));
});

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
	const scoped = spawnSync(
		process.execPath,
		[
			...args,
			"--team",
			providerProjects.teamId,
			"--staging-project",
			providerProjects.stagingProjectId,
			"--production-project",
			providerProjects.productionProjectId,
		],
		{ cwd: root, encoding: "utf8" },
	);
	assert.equal(scoped.status, 1);
	assert.equal(scoped.stderr, "");
	assert.deepEqual(JSON.parse(scoped.stdout).providerProjects, providerProjects);
	assert.equal(JSON.parse(scoped.stdout).evidenceReady, false);
	const partial = spawnSync(process.execPath, [...args, "--team", providerProjects.teamId], {
		cwd: root,
		encoding: "utf8",
	});
	assert.equal(partial.status, 1);
	assert.equal(partial.stdout, "");
	assert.match(partial.stderr, /Adoption evidence could not be checked/);
	assert.deepEqual(readdirSync(root), [".git"]);
});
