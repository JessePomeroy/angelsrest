import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { parseClientSetupPlan } from "../../src/lib/platformClientSetup.ts";
import { createSetupPlan } from "./plan.mjs";
import { prepareClientSetup } from "./prepare.mjs";

function fixture(t) {
	const root = mkdtempSync(join(tmpdir(), "client-setup-prepare-"));
	t.after(() => rmSync(root, { recursive: true, force: true }));
	execFileSync("git", ["init", "--quiet", root]);
	writeFileSync(join(root, "package.json"), "{}");
	const contract = JSON.parse(
		readFileSync(new URL("../../docs/examples/client-integration.json", import.meta.url), "utf8"),
	);
	return { root, contract };
}

test("the unchanged reviewed plan produces a bounded attachment accepted by the actual host parser", (t) => {
	const { root, contract } = fixture(t);
	contract.tenant.expectedTenantId = "tenant_11111111-1111-4111-8111-111111111111";
	contract.environmentRequirements.push({
		name: "CMS_MEDIA_WORKER_SECRET",
		purpose: "Host media bridge",
		service: "host",
		phase: "runtime",
		sensitive: true,
		capabilities: ["portfolio"],
	});
	const env = { CMS_MEDIA_WORKER_SECRET: "synthetic-do-not-include-this-value" };
	const plan = createSetupPlan(contract, root, "staging", env);
	const attachment = prepareClientSetup(contract, root, "staging", env, plan);
	assert.deepEqual(parseClientSetupPlan(attachment), attachment);
	assert.equal(attachment.identity.siteUrl, contract.tenant.siteUrl);
	assert.doesNotMatch(
		JSON.stringify(attachment),
		/synthetic-do-not-include|CMS_MEDIA_WORKER_SECRET/,
	);
	assert.equal(Object.hasOwn(attachment, "ready"), false);
	assert.equal(Object.hasOwn(attachment, "proposed"), false);
});

test("source, target, installed-state or reviewed-plan changes require a fresh review", (t) => {
	const { root, contract } = fixture(t);
	const plan = createSetupPlan(contract, root, "staging", {});
	const prepare = (reviewed = plan, env = {}) =>
		prepareClientSetup(contract, root, "staging", env, reviewed);
	assert.throws(() => prepare({ ...plan, ready: true }), /stale or differs/);
	assert.throws(
		() => prepare(plan, { PUBLIC_SITE_DOMAIN: contract.tenant.siteUrl }),
		/stale or differs/,
	);
	mkdirSync(join(root, "src"));
	writeFileSync(join(root, "src/changed.ts"), "export const changed = true;\n");
	assert.throws(() => prepare(), /stale or differs/);
	const fresh = createSetupPlan(contract, root, "staging", {});
	contract.environments[0].publicOrigin = "https://changed.example.test";
	assert.throws(() => prepare(fresh), /stale or differs/);
	assert.throws(
		() => prepareClientSetup(contract, root, "production", {}, fresh),
		/stale or differs/,
	);
	const installed = fixture(t);
	const reviewed = createSetupPlan(installed.contract, installed.root, "staging", {});
	const packageDirectory = join(installed.root, "node_modules/@jessepomeroy/admin");
	mkdirSync(packageDirectory, { recursive: true });
	writeFileSync(
		join(packageDirectory, "package.json"),
		JSON.stringify({
			name: "@jessepomeroy/admin",
			version: installed.contract.packages["@jessepomeroy/admin"],
		}),
	);
	assert.throws(
		() => prepareClientSetup(installed.contract, installed.root, "staging", {}, reviewed),
		/stale or differs/,
	);
});
