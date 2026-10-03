import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	symlinkSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { CAPABILITY_STAGES, contractFingerprint } from "./contract.mjs";
import {
	checkReadiness,
	inspectInventory,
	resolveRepositoryFile,
	sourceFingerprint,
} from "./inventory.mjs";

function fixture(t) {
	const directory = mkdtempSync(join(tmpdir(), "client-integration-"));
	t.after(() => rmSync(directory, { recursive: true, force: true }));
	const root = join(directory, "repository");
	mkdirSync(root);
	const contract = JSON.parse(
		readFileSync(new URL("../../docs/examples/client-integration.json", import.meta.url), "utf8"),
	);
	const write = (path, content = "synthetic fixture\n") => {
		mkdirSync(dirname(join(root, path)), { recursive: true });
		writeFileSync(join(root, path), content);
	};
	const git = (...args) =>
		execFileSync("git", args, { cwd: root, stdio: "pipe", encoding: "utf8" });
	git("init", "--quiet");
	for (const path of [
		...contract.stages.flatMap((stage) => stage.requiredFiles),
		...Object.values(contract.capabilities).flatMap((capability) => capability.requiredFiles),
	])
		write(path);
	write("docs/client-integration.json", JSON.stringify(contract));
	git("add", ".");
	return { directory, root, contract, write, git };
}

function recordEvidence(f, environmentId = "staging") {
	const source = sourceFingerprint(f.root, f.contract);
	const desired = contractFingerprint(f.contract);
	for (const stage of f.contract.stages) {
		const evidenceFile = `docs/integration-evidence/${environmentId}/${stage.id}.md`;
		f.write(evidenceFile, "Synthetic fixture; no live verification performed.\n");
		stage.verification[environmentId] = {
			verifiedAt: new Date().toISOString(),
			environmentId,
			siteUrl: f.contract.tenant.siteUrl,
			tenantId: "tenant-fixture",
			sourceFingerprint: source,
			contractFingerprint: desired,
			evidenceFile,
			checks: Object.fromEntries(
				Object.entries(f.contract.capabilities)
					.filter(([id]) => CAPABILITY_STAGES[id] === stage.id)
					.flatMap(([id, capability]) =>
						capability.checks.map((check) => [
							`${id}.${check.id}`,
							capability.status === "included" ? "passed" : "unavailable",
						]),
					),
			),
			releaseRecord: null,
			deploymentObservation: null,
		};
	}
	f.write("docs/client-integration.json", JSON.stringify(f.contract));
	return source;
}

test("portfolio-only handoff needs actual unavailable outcomes and all six environment records", (t) => {
	const f = fixture(t);
	assert.equal(checkReadiness(f.contract, f.root, "staging").length, 6);
	const source = recordEvidence(f);
	assert.deepEqual(checkReadiness(f.contract, f.root, "staging"), []);
	assert.equal(sourceFingerprint(f.root, f.contract), source);
	assert.equal(checkReadiness(f.contract, f.root, "production").length, 6);
	const commerce = f.contract.stages.find((stage) => stage.id === "commerce");
	delete commerce.verification.staging.checks["commerce.unavailable"];
	assert.ok(
		checkReadiness(f.contract, f.root, "staging").some((issue) =>
			issue.includes("requires a recorded unavailable"),
		),
	);
	commerce.verification.staging.checks["commerce.unavailable"] = "passed";
	assert.ok(
		checkReadiness(f.contract, f.root, "staging").some((issue) =>
			issue.includes("requires a recorded unavailable"),
		),
	);
});

test("staging evidence cannot certify production or a different tenant", (t) => {
	const f = fixture(t);
	f.contract.tenant.expectedTenantId = "tenant-fixture";
	recordEvidence(f);
	for (const stage of f.contract.stages)
		stage.verification.production = structuredClone(stage.verification.staging);
	assert.equal(
		checkReadiness(f.contract, f.root, "production").filter((issue) =>
			issue.includes("another environment"),
		).length,
		6,
	);
	f.contract.stages[0].verification.staging.tenantId = "tenant-other";
	f.contract.stages[1].verification.staging.siteUrl = "other.example.test";
	const issues = checkReadiness(f.contract, f.root, "staging");
	assert.equal(issues.filter((issue) => issue.includes("intended tenant binding")).length, 2);
	assert.ok(issues.includes("Stage evidence refers to different immutable tenants."));
});

test("unknown observed tenant identity remains pending even when desired identity is unspecified", (t) => {
	const f = fixture(t);
	recordEvidence(f);
	for (const stage of f.contract.stages) stage.verification.staging.tenantId = null;
	assert.equal(
		checkReadiness(f.contract, f.root, "staging").filter((issue) =>
			issue.includes("tenant binding"),
		).length,
		6,
	);
});

test("missing routes and changed desired scope invalidate prior readiness", (t) => {
	const f = fixture(t);
	recordEvidence(f);
	unlinkSync(join(f.root, "src/routes/portfolio/+page.server.ts"));
	assert.ok(
		inspectInventory(f.contract, f.root).issues.some((issue) =>
			issue.includes("src/routes/portfolio/+page.server.ts"),
		),
	);
	assert.ok(
		checkReadiness(f.contract, f.root, "staging").some((issue) =>
			issue.includes("stale for the current source"),
		),
	);
	f.write("src/routes/portfolio/+page.server.ts");
	f.contract.capabilities.commerce.reason = "Commerce is deferred until the next owner review.";
	assert.ok(
		checkReadiness(f.contract, f.root, "staging").some((issue) =>
			issue.includes("stale for the desired contract"),
		),
	);
});

test("fingerprints include dirty, untracked and explicitly inventoried files regardless of staging", (t) => {
	const f = fixture(t);
	f.contract.stages[0].requiredFiles.push("deployment/host-routes.json");
	f.write("deployment/host-routes.json", "original");
	const original = sourceFingerprint(f.root, f.contract);
	f.write("deployment/host-routes.json", "changed");
	assert.notEqual(sourceFingerprint(f.root, f.contract), original);
	f.write("deployment/host-routes.json", "original");
	f.write("src/lib/server/publicContent.ts", "dirty");
	assert.notEqual(sourceFingerprint(f.root, f.contract), original);
	f.write("src/lib/server/publicContent.ts");
	assert.equal(sourceFingerprint(f.root, f.contract), original);
	f.write("src/untracked.ts", "new source");
	assert.notEqual(sourceFingerprint(f.root, f.contract), original);
	unlinkSync(join(f.root, "src/untracked.ts"));
	unlinkSync(join(f.root, "src/lib/server/publicContent.ts"));
	const deleted = sourceFingerprint(f.root, f.contract);
	assert.notEqual(deleted, original);
	f.git("add", "-u");
	assert.equal(sourceFingerprint(f.root, f.contract), deleted);
	f.write("src/lib/server/publicContent.ts");
	assert.equal(sourceFingerprint(f.root, f.contract), original);
});

test("recording evidence cannot self-invalidate, while required runbook changes do", (t) => {
	const f = fixture(t);
	const source = recordEvidence(f);
	f.write("docs/integration-evidence/staging/backend.md", "More synthetic observations.\n");
	f.git("add", "docs/integration-evidence");
	assert.equal(sourceFingerprint(f.root, f.contract), source);
	f.write("docs/CLIENT_INTEGRATION.md", "Changed required runbook.\n");
	assert.notEqual(sourceFingerprint(f.root, f.contract), source);
});

test("source and evidence symlinks cannot escape the repository or target protected inputs", (t) => {
	const f = fixture(t);
	recordEvidence(f);
	const route = "src/routes/portfolio/+page.server.ts";
	const outside = join(f.directory, "outside.ts");
	writeFileSync(outside, "outside source");
	unlinkSync(join(f.root, route));
	symlinkSync(outside, join(f.root, route));
	assert.equal(resolveRepositoryFile(f.root, route), null);
	assert.ok(inspectInventory(f.contract, f.root).issues.length);
	assert.throws(() => sourceFingerprint(f.root, f.contract), /repository-contained/);
	unlinkSync(join(f.root, route));
	f.write(".env.local", "SYNTHETIC_PRIVATE_VALUE=never-hash-this");
	symlinkSync(join(f.root, ".env.local"), join(f.root, route));
	assert.equal(resolveRepositoryFile(f.root, route), null);
	assert.throws(() => sourceFingerprint(f.root, f.contract), /repository-contained/);
	unlinkSync(join(f.root, route));
	f.write(route);
	const evidence = f.contract.stages[0].verification.staging.evidenceFile;
	unlinkSync(join(f.root, evidence));
	symlinkSync(join(f.root, ".env.local"), join(f.root, evidence));
	assert.ok(
		checkReadiness(f.contract, f.root, "staging").some((issue) =>
			issue.includes("repository-contained evidence"),
		),
	);
});

test("a safe internal symlink works and a changed target changes the source fingerprint", (t) => {
	const f = fixture(t);
	const route = "src/routes/portfolio/+page.server.ts";
	f.write("src/first.ts", "same content");
	f.write("src/second.ts", "same content");
	unlinkSync(join(f.root, route));
	symlinkSync(join(f.root, "src/first.ts"), join(f.root, route));
	assert.equal(resolveRepositoryFile(f.root, route), join(f.root, "src/first.ts"));
	const first = sourceFingerprint(f.root, f.contract);
	unlinkSync(join(f.root, route));
	symlinkSync(join(f.root, "src/second.ts"), join(f.root, route));
	assert.notEqual(sourceFingerprint(f.root, f.contract), first);
});
