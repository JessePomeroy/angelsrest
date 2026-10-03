import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import {
	assertReleaseRecord,
	fingerprintPublicConfig,
} from "../../packages/crm-api/src/releases/records.mjs";
import { buildReleaseRecord, observePublicConfig } from "./build.mjs";

function buildFixture(t, client) {
	const root = mkdtempSync(join(tmpdir(), "release-producer-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const write = (path, value) => {
		const file = join(root, path);
		mkdirSync(dirname(file), { recursive: true });
		writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
	};
	const run = (command, args, cwd = root) =>
		execFileSync(command, args, {
			cwd,
			encoding: "utf8",
			stdio: ["ignore", "pipe", "pipe"],
			timeout: 30_000,
		}).trim();
	const contract = JSON.parse(
		readFileSync(new URL("../../docs/examples/client-integration.json", import.meta.url), "utf8"),
	);
	const versions = client
		? contract.packages
		: {
				"@jessepomeroy/admin": "6.7.1",
				"@jessepomeroy/crm-api": "6.5.1",
				"@jessepomeroy/gallery-delivery": "0.3.0",
				"@jessepomeroy/print-catalog": "0.3.1",
			};
	write("package.json", {
		name: "release-producer-fixture",
		private: true,
		dependencies: Object.fromEntries(Object.keys(versions).map((name) => [name, "workspace:*"])),
	});
	write("pnpm-workspace.yaml", 'packages:\n  - "packages/*"\n');
	write(".gitignore", "node_modules\n.svelte-kit\n.output\n.contract\n");
	for (const [name, version] of Object.entries(versions))
		write(`packages/${name.split("/")[1]}/package.json`, { name, version });
	if (client) write("docs/client-integration.json", contract);
	write("docs/contracts/commerce-intake.md", "Synthetic interface fixture.");
	write("docs/contracts/platform-client-provisioning.md", "Synthetic provisioning fixture.");
	// This fixture has only local workspace dependencies; it never requests a registry package.
	run("pnpm", ["install", "--offline", "--ignore-scripts", "--no-frozen-lockfile"]);
	write(".svelte-kit/output/client/app.js", "/* synthetic build output */");
	write(".contract/gallery-worker/README.md", "Synthetic Worker contract checkout.");
	const commit = (cwd) => {
		run("git", ["init", "--quiet"], cwd);
		run("git", ["add", "."], cwd);
		run(
			"git",
			[
				"-c",
				"user.name=Fixture",
				"-c",
				"user.email=fixture@example.test",
				"commit",
				"--quiet",
				"-m",
				"fixture",
			],
			cwd,
		);
		return run("git", ["rev-parse", "HEAD"], cwd);
	};
	const workerRevision = commit(join(root, ".contract/gallery-worker"));
	const sourceRevision = commit(root);
	const environment = contract.environments.find(({ id }) => id === "staging");
	const env = {
		PUBLIC_SITE_URL: environment.publicOrigin,
		PUBLIC_CONVEX_URL: environment.convexUrl,
		PUBLIC_CONVEX_SITE_URL: environment.convexSiteUrl,
		PUBLIC_CMS_MEDIA_BASE_URL: environment.cmsMediaOrigin,
		CHECKOUT_SNAPSHOT_MODE: "handle-v2",
		GITHUB_SHA: sourceRevision,
		GITHUB_REPOSITORY: contract.repository,
		GITHUB_RUN_ID: "1",
		GITHUB_RUN_ATTEMPT: "1",
		GITHUB_EVENT_NAME: "pull_request",
		GITHUB_REF: "refs/pull/1/merge",
		RELEASE_HEAD_SHA: "a".repeat(40),
		RELEASE_SITE_URL: contract.tenant.siteUrl,
		RELEASE_ENVIRONMENT: "staging",
		RELEASE_WORKFLOW_PATH: ".github/workflows/ci.yml",
		RELEASE_WORKER_REVISION: workerRevision,
		RELEASE_CHECKS_JSON: JSON.stringify(
			Object.fromEntries(
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
		),
	};
	return { root, env };
}

test("the complete producer binds real Git and pnpm observations for the hub and a two-package client", (t) => {
	for (const client of [false, true]) {
		const { root, env } = buildFixture(t, client);
		const result = buildReleaseRecord(root, env);
		assertReleaseRecord(result);
		assert.equal(result.data.sourceRevision, env.GITHUB_SHA);
		assert.equal(result.data.github.headSha, "a".repeat(40));
		assert.notEqual(result.data.sourceRevision, result.data.github.headSha);
		assert.equal(result.data.packages.length, client ? 2 : 4);
		assert.equal(result.identity.contractFingerprint === null, !client);
		assert.equal(result.data.sourceFingerprint === null, !client);
		assert.equal(result.data.output.fileCount, 1);
		assert.equal(
			result.data.requiredContracts.workers[0].sourceRevision,
			env.RELEASE_WORKER_REVISION,
		);
		if (!client) {
			const cli = fileURLToPath(new URL("../release-record.mjs", import.meta.url));
			const invoke = () =>
				spawnSync(process.execPath, [cli, "build"], {
					cwd: root,
					encoding: "utf8",
					env: { PATH: process.env.PATH, ...env },
					timeout: 30_000,
				});
			assert.equal(invoke().status, 0);
			const path = join(root, ".output/release-record/build.json");
			const saved = readFileSync(path, "utf8");
			assertReleaseRecord(JSON.parse(saved));
			assert.equal(invoke().status, 1);
			assert.equal(readFileSync(path, "utf8"), saved);
			rmSync(join(root, ".output"), { recursive: true });
			const outside = mkdtempSync(join(tmpdir(), "release-output-"));
			t.after(() => rmSync(outside, { recursive: true, force: true }));
			symlinkSync(outside, join(root, ".output"));
			assert.equal(invoke().status, 1);
			assert.deepEqual(readdirSync(outside), []);
		}
		assert.throws(
			() => buildReleaseRecord(root, { ...env, RELEASE_WORKER_REVISION: "b".repeat(40) }),
			/Worker checkout/,
		);
		writeFileSync(
			join(root, ".contract/gallery-worker/README.md"),
			"Modified contract implementation.",
		);
		assert.throws(() => buildReleaseRecord(root, env), /Worker checkout is modified/);
	}
});

test("configuration observation cannot include credentials or change when private values rotate", () => {
	const env = {
		PUBLIC_SITE_URL: "https://example.test",
		PUBLIC_CONVEX_URL: "https://fixture.convex.cloud",
		PUBLIC_CONVEX_SITE_URL: "https://fixture.convex.site",
		CHECKOUT_SNAPSHOT_MODE: "handle-v2",
		STRIPE_SECRET_KEY: "private-canary-one",
		WEBHOOK_SECRET: "another-private-canary",
	};
	const config = observePublicConfig(env);
	const before = fingerprintPublicConfig(config);
	env.STRIPE_SECRET_KEY = "private-canary-two";
	assert.equal(fingerprintPublicConfig(observePublicConfig(env)), before);
	assert.equal(JSON.stringify(config).includes("canary"), false);
	assert.equal(config.cmsMediaOrigin, null);
	env.PUBLIC_SITE_URL = "https://other.example.test";
	assert.notEqual(fingerprintPublicConfig(observePublicConfig(env)), before);
	env.PUBLIC_SITE_URL = "https://private-canary@example.test";
	assert.throws(() => fingerprintPublicConfig(observePublicConfig(env)));
});

test("CLI failures do not echo environment values or subprocess error payloads", (t) => {
	const root = mkdtempSync(join(tmpdir(), "release-cli-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const cli = fileURLToPath(new URL("../release-record.mjs", import.meta.url));
	const result = spawnSync(process.execPath, [cli, "build"], {
		cwd: root,
		encoding: "utf8",
		env: {
			PATH: process.env.PATH,
			GITHUB_SHA: "private-canary",
			RELEASE_CHECKS_JSON: "private-canary",
		},
	});
	assert.equal(result.status, 1);
	assert.equal(result.stdout, "");
	assert.match(result.stderr, /Release record could not be generated/);
	assert.doesNotMatch(result.stderr, /private-canary|fatal:/);
});
