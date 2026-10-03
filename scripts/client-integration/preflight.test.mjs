import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { parseTenantSecretRegistry } from "../../packages/crm-api/convex/helpers/serverSecrets.ts";
import {
	checkCandidate,
	checkConvexRegistry,
	checkPreflight,
	loadRegistryValidator,
} from "./preflight.mjs";

function fixture() {
	return JSON.parse(
		readFileSync(new URL("../../docs/examples/client-integration.json", import.meta.url), "utf8"),
	);
}

function configured(contract, id = "staging") {
	const environment = contract.environments.find((item) => item.id === id);
	return {
		PUBLIC_SITE_DOMAIN: contract.tenant.siteUrl,
		PUBLIC_CONVEX_URL: environment.convexUrl,
		PUBLIC_CONVEX_SITE_URL: environment.convexSiteUrl,
		PUBLIC_CMS_MEDIA_BASE_URL: environment.cmsMediaOrigin,
	};
}

test("preflight checks only supplied settings and rejects wrong tenant, environment and media binding", (t) => {
	const contract = fixture();
	const env = configured(contract);
	const request = t.mock.method(globalThis, "fetch", () => {
		throw new Error("Unexpected network");
	});
	assert.deepEqual(checkPreflight(contract, "staging", env).issues, []);
	assert.deepEqual(
		checkPreflight(contract, "staging", { ...env, SITE_PUBLIC_ORIGIN: undefined }).issues,
		[],
	);
	assert.equal(
		checkPreflight(contract, "staging", {}).checks.filter(({ status }) => status === "missing")
			.length,
		4,
	);
	for (const wrong of [
		{ PUBLIC_SITE_DOMAIN: "other.example.test" },
		configured(contract, "production"),
		{ PUBLIC_CONVEX_SITE_URL: "https://other.convex.site" },
		{ PUBLIC_CMS_MEDIA_BASE_URL: "https://other-media.example.test" },
		{ SITE_PUBLIC_ORIGIN: contract.environments[1].publicOrigin },
		{ PUBLIC_CONVEX_URL: "https://secret@example.test" },
		{ PUBLIC_CMS_MEDIA_BASE_URL: "https://media.example.test?secret=value" },
	]) {
		const result = checkPreflight(contract, "staging", { ...env, ...wrong });
		assert.ok(result.issues.length > 0);
		assert.ok(result.checks.some(({ status }) => status === "invalid"));
		assert.doesNotMatch(JSON.stringify(result), /secret@example|secret=value|other-media\.example/);
	}
	assert.throws(() => checkPreflight(contract, "undeclared", env), /not declared/);
	assert.equal(request.mock.callCount(), 0);
});

test("capability scope controls presence checks, and host settings cannot certify remote services", () => {
	const contract = fixture();
	const secret = "synthetic-secret-never-returned";
	contract.environmentRequirements.push(
		{
			name: "CMS_MEDIA_WORKER_SECRET",
			purpose: "Host media bridge",
			service: "host",
			phase: "runtime",
			sensitive: true,
			capabilities: ["portfolio"],
		},
		{
			name: "CMS_MEDIA_WORKER_SECRET",
			purpose: "Remote media bridge",
			service: "cms-worker",
			phase: "runtime",
			sensitive: true,
			capabilities: ["portfolio"],
		},
		{
			name: "CHECKOUT_BRIDGE_SECRET",
			purpose: "Checkout",
			service: "host",
			phase: "runtime",
			sensitive: true,
			capabilities: ["commerce"],
		},
	);
	const missing = checkPreflight(contract, "staging", configured(contract));
	assert.ok(missing.issues.some((issue) => issue.startsWith("CMS_MEDIA_WORKER_SECRET:")));
	const result = checkPreflight(contract, "staging", {
		...configured(contract),
		CMS_MEDIA_WORKER_SECRET: secret,
		CHECKOUT_BRIDGE_SECRET: secret,
	});
	assert.deepEqual(result.issues, []);
	assert.deepEqual(
		result.checks
			.filter(({ name }) => name === "CMS_MEDIA_WORKER_SECRET")
			.map(({ service, status }) => ({ service, status })),
		[
			{ service: "host", status: "present" },
			{ service: "cms-worker", status: "unknown" },
		],
	);
	assert.equal(
		result.checks.some(({ name }) => name === "CHECKOUT_BRIDGE_SECRET"),
		false,
	);
	assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
});

test("protected registry checks use the current parser without claiming other tenants are preserved", () => {
	const siteUrl = fixture().tenant.siteUrl;
	const secret = "synthetic-only-credential-0123456789abcdef";
	for (const raw of [
		`{"${siteUrl}":"${secret}"`,
		JSON.stringify({ [siteUrl]: secret }),
		JSON.stringify({ [siteUrl]: [secret], "other.example.test": [secret] }),
		"x".repeat(262_145),
	]) {
		const result = checkConvexRegistry(raw, siteUrl, parseTenantSecretRegistry);
		assert.equal(result.valid, false);
		assert.equal(result.preservation, "unknown");
		assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
	}
	const absent = checkConvexRegistry(
		JSON.stringify({ "other.example.test": [secret] }),
		siteUrl,
		parseTenantSecretRegistry,
	);
	assert.equal(absent.valid, true);
	assert.equal(absent.tenantPresent, false);
	assert.equal(absent.issues.length, 1);
	assert.deepEqual(
		checkConvexRegistry(
			JSON.stringify({ [siteUrl]: [secret] }),
			siteUrl,
			parseTenantSecretRegistry,
		),
		{
			valid: true,
			tenantPresent: true,
			issues: [],
			preservation: "unknown",
		},
	);
	const failed = checkConvexRegistry(secret, siteUrl, () => {
		throw new Error(secret);
	});
	assert.equal(failed.valid, false);
	assert.doesNotMatch(JSON.stringify(failed), new RegExp(secret));
});

test("a missing consuming installation fails without exposing loader paths or making requests", async (t) => {
	const request = t.mock.method(globalThis, "fetch", () => {
		throw new Error("Unexpected network");
	});
	await assert.rejects(loadRegistryValidator("/nonexistent/synthetic-sensitive-path"), {
		message: "The consuming CRM registry validator is unavailable.",
	});
	assert.equal(request.mock.callCount(), 0);
});

test("explicit candidate probes use only the selected origin and contract public route without credentials", async () => {
	const contract = fixture();
	contract.environments[0].publicPath = "/photos";
	const calls = [];
	const result = await checkCandidate(contract, "staging", async (url, options) => {
		calls.push({ url: String(url), options });
		return new Response(url.pathname === "/photos" ? "<html></html>" : " null\n", {
			headers: {
				"content-type":
					url.pathname === "/photos" ? "text/html; charset=utf-8" : "application/json",
			},
		});
	});
	assert.deepEqual(result.issues, []);
	assert.deepEqual(
		calls.map(({ url }) => url),
		[
			"https://staging.portfolio.example.test/photos",
			"https://staging.portfolio.example.test/api/auth/get-session",
		],
	);
	for (const { options } of calls) {
		assert.equal(options.credentials, "omit");
		assert.equal(options.redirect, "error");
		assert.equal(options.method, "GET");
		assert.ok(options.signal instanceof AbortSignal);
		assert.deepEqual(Object.keys(options.headers), ["Accept"]);
	}
});

test("candidate failures are bounded and redacted, including a non-anonymous session or oversized body", async () => {
	const contract = fixture();
	const secret = "synthetic-private-response-value";
	for (const response of [
		() => new Response(secret, { status: 500 }),
		() => new Response(`<html>${secret}</html>`, { headers: { "content-type": "text/html" } }),
		() =>
			new Response(JSON.stringify({ user: secret }), {
				headers: { "content-type": "application/json" },
			}),
		() =>
			new Response(`null${" ".repeat(1025)}`, { headers: { "content-type": "application/json" } }),
		() => {
			throw new Error(secret);
		},
	]) {
		const result = await checkCandidate(contract, "staging", async () => response());
		assert.ok(result.issues.length > 0);
		assert.doesNotMatch(JSON.stringify(result), new RegExp(secret));
		assert.ok(result.issues.every((issue) => issue.includes("Keep the existing deployment")));
	}
	let calls = 0;
	await assert.rejects(
		checkCandidate(contract, "undeclared", async () => {
			calls++;
		}),
		/not declared/,
	);
	assert.equal(calls, 0);
});
