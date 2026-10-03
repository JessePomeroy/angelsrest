import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { createSetupPlan } from "./plan.mjs";

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "angelsrest-setup-plan-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	const contract = JSON.parse(
		readFileSync(new URL("../../docs/examples/client-integration.json", import.meta.url), "utf8"),
	);
	execFileSync("git", ["init", "-q", root]);
	function write(path, contents) {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), contents);
	}
	write(
		"package.json",
		JSON.stringify({ name: "synthetic-client", dependencies: contract.packages }),
	);
	write("docs/client-integration.json", JSON.stringify(contract));
	const environment = contract.environments[0];
	const env = {
		PUBLIC_SITE_DOMAIN: contract.tenant.siteUrl,
		PUBLIC_CONVEX_URL: environment.convexUrl,
		PUBLIC_CONVEX_SITE_URL: environment.convexSiteUrl,
		PUBLIC_CMS_MEDIA_BASE_URL: environment.cmsMediaOrigin,
	};
	return { root, contract, env, write };
}

test("a setup plan exposes concrete intent and missing work while remaining offline and read-only", (t) => {
	const { root, contract, env } = fixture(t);
	const request = t.mock.method(globalThis, "fetch", () => {
		throw new Error("Unexpected network");
	});
	const before = readdirSync(root, { recursive: true });
	const packageBefore = readFileSync(join(root, "package.json"), "utf8");
	const plan = createSetupPlan(contract, root, "staging", env);
	assert.equal(plan.mode, "read-only");
	assert.equal(plan.ready, false);
	assert.equal(plan.target.publicOrigin, contract.environments[0].publicOrigin);
	assert.equal(plan.target.convexUrl, contract.environments[0].convexUrl);
	assert.equal(plan.target.cmsMediaOrigin, contract.environments[0].cmsMediaOrigin);
	assert.deepEqual(plan.target.packages, contract.packages);
	assert.deepEqual(plan.target.contracts, contract.contracts);
	assert.equal(plan.identity.repository, contract.repository);
	assert.equal(plan.identity.sourceRevision, null);
	assert.match(plan.identity.sourceFingerprint, /^[a-f0-9]{64}$/);
	assert.match(plan.identity.contractFingerprint, /^[a-f0-9]{64}$/);
	assert.ok(plan.missing.files.length > 0);
	assert.equal(plan.missing.packages.length, 2);
	assert.ok(
		plan.missing.packages.every(
			({ installedVersion, status }) => installedVersion === null && status === "missing",
		),
	);
	assert.ok(plan.proposed.some(({ status }) => status === "requires-authorized-provisioning"));
	assert.ok(plan.unknown.some((item) => item.includes("Deployed source")));
	assert.deepEqual(readdirSync(root, { recursive: true }), before);
	assert.equal(readFileSync(join(root, "package.json"), "utf8"), packageBefore);
	assert.equal(request.mock.callCount(), 0);
});

test("package observations resolve installed metadata without executing entries or trusting declarations", (t) => {
	const { root, contract, env, write } = fixture(t);
	for (const [name, version] of Object.entries(contract.packages)) {
		write(
			`node_modules/${name}/package.json`,
			JSON.stringify({
				name,
				version: name.endsWith("admin") ? version : "1.0.0",
				exports: "./dist/index.js",
			}),
		);
		write(
			`node_modules/${name}/dist/index.js`,
			"throw new Error('Package entry must never execute');\n",
		);
	}
	const plan = createSetupPlan(contract, root, "staging", env);
	assert.deepEqual(
		plan.existing.packages.map(({ name, installedVersion, status }) => ({
			name,
			installedVersion,
			status,
		})),
		[
			{ name: "@jessepomeroy/admin", installedVersion: "6.7.1", status: "matched" },
			{ name: "@jessepomeroy/crm-api", installedVersion: "1.0.0", status: "mismatch" },
		],
	);
	assert.equal(plan.missing.packages.length, 1);
	assert.equal(plan.missing.packages[0].name, "@jessepomeroy/crm-api");
});

test("retained routes for an excluded capability do not count as activation or verification", (t) => {
	const { root, contract, env, write } = fixture(t);
	const path = "src/routes/api/checkout/+server.ts";
	contract.capabilities.commerce.requiredFiles = [path];
	write(path, "export const POST = () => new Response(null, { status: 503 });\n");
	const plan = createSetupPlan(contract, root, "staging", env);
	assert.equal(plan.target.scope.commerce.status, "excluded");
	assert.ok(plan.existing.files.some((file) => file.path === path));
	assert.ok(
		plan.proposed.some(
			({ kind, description, status }) =>
				kind === "commerce" &&
				description.includes("unavailable") &&
				status === "requires-verification",
		),
	);
	assert.equal(plan.ready, false);
	assert.ok(plan.unknown.some((item) => item.includes("Enabled capabilities")));
});

test("plans never serialize secret values and remain bound to the selected contract and source", (t) => {
	const { root, contract, env, write } = fixture(t);
	const secret = "synthetic-sensitive-plan-input";
	contract.environmentRequirements.push({
		name: "CMS_MEDIA_WORKER_SECRET",
		purpose: "Host bridge",
		service: "host",
		phase: "runtime",
		sensitive: true,
		capabilities: ["portfolio"],
	});
	const supplied = { ...env, CMS_MEDIA_WORKER_SECRET: secret, UNUSED_SECRET: secret };
	const first = createSetupPlan(contract, root, "staging", supplied);
	assert.doesNotMatch(JSON.stringify(first), new RegExp(secret));
	write("src/new-route.ts", "export const marker = true;\n");
	const changed = createSetupPlan(contract, root, "staging", supplied);
	assert.notEqual(changed.identity.sourceFingerprint, first.identity.sourceFingerprint);
	assert.equal(changed.identity.contractFingerprint, first.identity.contractFingerprint);
	contract.environments[0].publicOrigin = "https://new-staging.portfolio.example.test";
	const newTarget = createSetupPlan(contract, root, "staging", supplied);
	assert.notEqual(newTarget.identity.contractFingerprint, first.identity.contractFingerprint);
	assert.equal(newTarget.target.publicOrigin, contract.environments[0].publicOrigin);
	const wrongEnvironment = createSetupPlan(contract, root, "production", supplied);
	assert.ok(wrongEnvironment.missing.configuration.some(({ status }) => status === "invalid"));
});
