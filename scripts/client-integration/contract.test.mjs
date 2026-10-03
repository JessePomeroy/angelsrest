import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
	assertContract,
	contractFingerprint,
	createPendingManifest,
	getEnvironment,
	isRepositoryPath,
	validateContract,
} from "./contract.mjs";

const fixture = () =>
	JSON.parse(
		readFileSync(new URL("../../docs/examples/client-integration.json", import.meta.url), "utf8"),
	);

test("the shared portfolio-only example declares both environments and every exclusion", () => {
	const contract = fixture();
	assert.deepEqual(validateContract(contract), []);
	assert.equal(
		getEnvironment(contract, "production").publicOrigin,
		"https://portfolio.example.test",
	);
	assert.throws(() => getEnvironment(contract, "undeclared"), /not declared/);
	assert.equal(contract.capabilities.commerce.status, "excluded");
	assert.equal(contract.stages.length, 6);
});

test("rejects wrong tenant, backend pairing, package ranges, undeclared settings and partial stages", () => {
	const changes = [
		(contract) => {
			contract.version = 1;
		},
		(contract) => {
			contract.tenant.siteUrl = "https://other.example.test";
		},
		(contract) => {
			contract.tenant.expectedTenantId = " tenant-wrong ";
		},
		(contract) => {
			contract.environments[0].convexSiteUrl = "https://wrong.convex.site";
		},
		(contract) => {
			contract.environments[0].convexUrl = null;
			contract.environments[0].convexSiteUrl = null;
		},
		(contract) => {
			contract.environments[0].cmsMediaOrigin = null;
		},
		(contract) => {
			contract.environments[0].publicOrigin += "/path";
		},
		(contract) => {
			contract.packages["@jessepomeroy/admin"] = "^6.7.1";
		},
		(contract) => {
			contract.enabledPages = ["portfolio"];
		},
		(contract) => {
			contract.stages.pop();
		},
	];
	for (const change of changes) {
		const contract = fixture();
		change(contract);
		assert.ok(validateContract(contract).length > 0);
	}
	for (const malformed of [null, {}, [], "version 2"])
		assert.ok(validateContract(malformed).length);
});

test("scope requires real source paths, exclusion reasons and named behavioral checks", () => {
	const contract = fixture();
	contract.capabilities.commerce.reason = "";
	contract.capabilities.blog.checks = [];
	contract.capabilities.portfolio.requiredFiles = [];
	const issues = validateContract(contract);
	assert.ok(issues.some((issue) => issue.startsWith("commerce:")));
	assert.ok(issues.some((issue) => issue.startsWith("blog:")));
	assert.ok(issues.some((issue) => issue.startsWith("portfolio:")));
	const commerce = fixture();
	commerce.capabilities.commerce.status = "included";
	commerce.capabilities.commerce.requiredFiles = ["src/routes/api/checkout/+server.ts"];
	assert.ok(validateContract(commerce).some((issue) => issue.includes("catalog capability")));
});

test("file requirements reject traversal, credentials, generated output and evidence sources", () => {
	for (const path of [
		"../outside.ts",
		"/tmp/route.ts",
		"src/../route.ts",
		"src\\route.ts",
		".env",
		".env.local",
		".git/config",
		"node_modules/host/index.js",
		".vercel/output/config.json",
		"dist/index.js",
	]) {
		assert.equal(isRepositoryPath(path), false, path);
		const contract = fixture();
		contract.capabilities.portfolio.requiredFiles = [path];
		assert.ok(validateContract(contract).length, path);
	}
	assert.equal(isRepositoryPath(".env.example"), true);
	assert.equal(isRepositoryPath("src/routes/api/auth/[...all]/+server.ts"), true);
	const contract = fixture();
	contract.capabilities.portfolio.requiredFiles = ["docs/integration-evidence/pretend-route.ts"];
	assert.ok(validateContract(contract).length);
});

test("environment requirements separate services and reject secret values or public secrets", () => {
	const contract = fixture();
	const host = {
		name: "CMS_MEDIA_WORKER_SECRET",
		purpose: "CMS upload capability",
		service: "host",
		phase: "runtime",
		sensitive: true,
		capabilities: ["portfolio"],
	};
	contract.environmentRequirements.push(host, { ...host, service: "cms-worker" });
	assert.deepEqual(validateContract(contract), []);
	contract.environmentRequirements.push({ ...host });
	assert.ok(validateContract(contract).some((issue) => issue.includes("unique")));
	contract.environmentRequirements.pop();
	host.value = "must-never-appear-in-diagnostics";
	assert.ok(validateContract(contract).length);
	assert.ok(!validateContract(contract).join(" ").includes(host.value));
	delete host.value;
	host.name = "PUBLIC_SECRET";
	assert.ok(validateContract(contract).length);
});

test("contract fingerprints ignore object key order and observations but bind desired scope", () => {
	const contract = fixture();
	const fingerprint = contractFingerprint(contract);
	const reversed = Object.fromEntries(Object.entries(contract).reverse());
	assert.equal(contractFingerprint(reversed), fingerprint);
	contract.stages[0].verification.staging = {
		verifiedAt: "2026-01-01T00:00:00.000Z",
		environmentId: "staging",
		siteUrl: contract.tenant.siteUrl,
		tenantId: "tenant-fixture",
		sourceFingerprint: "a".repeat(64),
		contractFingerprint: fingerprint,
		evidenceFile: "docs/integration-evidence/staging/backend.md",
		checks: {},
		releaseRecord: null,
		deploymentObservation: null,
	};
	assert.equal(contractFingerprint(contract), fingerprint);
	contract.capabilities.commerce.reason = "Owner approved a later commerce phase.";
	assert.notEqual(contractFingerprint(contract), fingerprint);
	const pending = createPendingManifest(contract);
	assert.ok(contract.stages[0].verification.staging !== null);
	assert.ok(
		pending.stages.every((stage) =>
			Object.values(stage.verification).every((value) => value === null),
		),
	);
	assert.equal(contractFingerprint(pending), contractFingerprint(contract));
});

test("evidence schema requires environment-specific records and bounded local evidence paths", () => {
	const contract = fixture();
	contract.stages[0].verification = { staging: null };
	assert.throws(() => assertContract(contract), /verification/);
	const pending = createPendingManifest(contract);
	assert.deepEqual(pending.stages[0].verification, { staging: null, production: null });
	const duplicate = fixture();
	duplicate.environments[1].id = "staging";
	assert.ok(validateContract(duplicate).some((issue) => issue.includes("unique")));
});
