import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getEnvironment, isHttpsOrigin } from "./contract.mjs";

const REGISTRY_BYTE_LIMIT = 262_144;

function httpsOrigin(value) {
	return isHttpsOrigin(value) ? value : null;
}

/** Check supplied configuration only; neither environment loading nor I/O belongs here. */
export function checkPreflight(contract, environmentId, env) {
	const environment = getEnvironment(contract, environmentId);
	if (!env || typeof env !== "object" || Array.isArray(env))
		throw new Error("Preflight requires an explicit environment map.");
	const activeRequirements = contract.environmentRequirements.filter(
		({ capabilities }) =>
			capabilities.length === 0 ||
			capabilities.some((capability) => contract.capabilities[capability].status === "included"),
	);
	const requirements = new Map(
		activeRequirements.filter(({ service }) => service === "host").map((item) => [item.name, item]),
	);
	const requiredPublic = ["PUBLIC_SITE_DOMAIN", "PUBLIC_CONVEX_URL", "PUBLIC_CONVEX_SITE_URL"];
	if (environment.cmsMediaOrigin !== null) requiredPublic.push("PUBLIC_CMS_MEDIA_BASE_URL");
	if (contract.capabilities.commerce.status === "included")
		requiredPublic.push("SITE_PUBLIC_ORIGIN");
	for (const name of requiredPublic) {
		if (!requirements.has(name))
			requirements.set(name, { name, service: "host", phase: "build", sensitive: false });
	}
	for (const name of ["SITE_PUBLIC_ORIGIN", "PUBLIC_CMS_MEDIA_BASE_URL"]) {
		if (
			Object.hasOwn(env, name) &&
			env[name] !== undefined &&
			env[name] !== "" &&
			!requirements.has(name)
		)
			requirements.set(name, { name, service: "host", phase: "runtime", sensitive: false });
	}

	const issues = [];
	const checks = [];
	const expectedOrigins = {
		SITE_PUBLIC_ORIGIN: environment.publicOrigin,
		PUBLIC_CONVEX_URL: environment.convexUrl,
		PUBLIC_CONVEX_SITE_URL: environment.convexSiteUrl,
		PUBLIC_CMS_MEDIA_BASE_URL: environment.cmsMediaOrigin,
	};
	for (const { name, service, phase, sensitive } of requirements.values()) {
		const value = Object.hasOwn(env, name) ? env[name] : undefined;
		let status = "present";
		if (typeof value !== "string" || value.trim().length === 0) {
			status = "missing";
			issues.push(`${name}: required configuration is missing.`);
		} else if (name === "PUBLIC_SITE_DOMAIN") {
			status = value === contract.tenant.siteUrl ? "valid" : "invalid";
			if (status === "invalid") issues.push(`${name}: does not match the contract tenant.`);
		} else if (Object.hasOwn(expectedOrigins, name)) {
			const origin = httpsOrigin(value);
			const expected = expectedOrigins[name];
			status = origin && origin === expected ? "valid" : "invalid";
			if (status === "invalid")
				issues.push(`${name}: must be an HTTPS origin matching the selected environment.`);
		}
		checks.push({ name, service, phase, sensitive, status });
	}
	const convex = httpsOrigin(env.PUBLIC_CONVEX_URL);
	const convexSite = httpsOrigin(env.PUBLIC_CONVEX_SITE_URL);
	if (convex && convexSite) {
		const cloudHost = new URL(convex).hostname;
		if (
			cloudHost.endsWith(".convex.cloud") &&
			new URL(convexSite).hostname !== cloudHost.replace(/\.convex\.cloud$/, ".convex.site")
		) {
			issues.push("Public Convex endpoints must identify the same deployment.");
			for (const check of checks)
				if (["PUBLIC_CONVEX_URL", "PUBLIC_CONVEX_SITE_URL"].includes(check.name))
					check.status = "invalid";
		}
	}
	for (const { name, service, phase, sensitive } of activeRequirements)
		if (service !== "host") checks.push({ name, service, phase, sensitive, status: "unknown" });
	return { environmentId: environment.id, checks, issues };
}

/** Load only on an explicit protected-registry check, from the consuming installation. */
export async function loadRegistryValidator(root) {
	try {
		const consumerRequire = createRequire(resolve(root, "package.json"));
		const api = pathToFileURL(consumerRequire.resolve("@jessepomeroy/crm-api/api"));
		const source = new URL("../convex/helpers/serverSecrets.ts", api);
		const { transformWithEsbuild } = await import(
			pathToFileURL(consumerRequire.resolve("vite")).href
		);
		const { code } = await transformWithEsbuild(await readFile(source, "utf8"), source.pathname, {
			loader: "ts",
			format: "esm",
		});
		const module = await import(
			`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`
		);
		if (typeof module.parseTenantSecretRegistry !== "function") throw new Error();
		return module.parseTenantSecretRegistry;
	} catch {
		throw new Error("The consuming CRM registry validator is unavailable.");
	}
}

/** Schema and tenant presence do not prove preservation of a deployed multi-tenant registry. */
export function checkConvexRegistry(raw, siteUrl, parseRegistry) {
	let registry = null;
	try {
		if (typeof raw === "string" && Buffer.byteLength(raw) <= REGISTRY_BYTE_LIMIT)
			registry = parseRegistry(raw);
	} catch {
		// Parser errors may contain protected input. Only fixed diagnostics leave this boundary.
	}
	const valid = registry instanceof Map;
	const tenantPresent = valid && registry.has(siteUrl);
	const issues = [];
	if (!valid) issues.push("Invalid registry input for the consuming CRM release.");
	else if (!tenantPresent) issues.push("The contract tenant is absent from the proposed registry.");
	return { valid, tenantPresent, issues, preservation: "unknown" };
}

async function anonymousSession(response) {
	if (!response.body) return false;
	const reader = response.body.getReader();
	const chunks = [];
	let bytes = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) return Buffer.concat(chunks).toString("utf8").trim() === "null";
			bytes += value.byteLength;
			if (bytes > 1024) return false;
			chunks.push(value);
		}
	} finally {
		await reader.cancel();
		reader.releaseLock();
	}
}

/** The caller explicitly selects this network check; plans never invoke it. */
export async function checkCandidate(contract, environmentId, request = fetch) {
	const environment = getEnvironment(contract, environmentId);
	const checks = [];
	const issues = [];
	for (const [path, contentType] of [
		[environment.publicPath, "text/html"],
		["/api/auth/get-session", "application/json"],
	]) {
		let response;
		let passed = false;
		try {
			response = await request(new URL(path, environment.publicOrigin), {
				method: "GET",
				credentials: "omit",
				redirect: "error",
				cache: "no-store",
				headers: { Accept: contentType },
				signal: AbortSignal.timeout(10_000),
			});
			passed =
				response.status === 200 &&
				response.headers.get("content-type")?.split(";")[0].trim().toLowerCase() === contentType &&
				(contentType === "text/html" || (await anonymousSession(response)));
		} catch {
			// Response bodies, redirect destinations and network errors are not diagnostic output.
		} finally {
			try {
				await response?.body?.cancel();
			} catch {
				// Reading or canceling an already-consumed body does not change the check outcome.
			}
		}
		checks.push({ path, status: passed ? "passed" : "failed" });
		if (!passed)
			issues.push(`${path}: candidate health check failed. Keep the existing deployment.`);
	}
	return {
		environmentId: environment.id,
		checks,
		issues,
		limitation:
			"Public and anonymous-auth health only; tenant access, deployment identity and client handoff remain unverified.",
	};
}
