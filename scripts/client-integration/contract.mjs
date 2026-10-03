import { createHash } from "node:crypto";

export const STAGE_IDS = Object.freeze([
	"backend",
	"tenant",
	"content",
	"workflows",
	"commerce",
	"handoff",
]);
export const CAPABILITY_STAGES = Object.freeze({
	portfolio: "content",
	sitePages: "content",
	blog: "content",
	catalog: "content",
	privateCatalogAssets: "content",
	crm: "workflows",
	delivery: "workflows",
	commerce: "commerce",
});
export const ENVIRONMENT_SERVICES = Object.freeze([
	"host",
	"convex",
	"cms-worker",
	"gallery-worker",
	"hub",
]);
const capabilityIds = Object.keys(CAPABILITY_STAGES);
const fingerprintPattern = /^[a-f0-9]{64}$/;
const identifier = /^[a-z][a-z0-9-]{0,79}$/;
const exactVersion =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;
const protectedSegments = new Set([
	".git",
	"node_modules",
	".svelte-kit",
	".vercel",
	".wrangler",
	"coverage",
	"build",
	"dist",
]);

function record(value) {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		[Object.prototype, null].includes(Object.getPrototypeOf(value))
	);
}

function exactKeys(value, keys) {
	return (
		record(value) &&
		Object.keys(value).length === keys.length &&
		keys.every((key) => Object.hasOwn(value, key))
	);
}

function text(value, maximum = 1000) {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= maximum &&
		value === value.trim() &&
		[...value].every(
			(character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
		)
	);
}

function uniqueList(value, predicate, minimum = 0, maximum = 100) {
	return (
		Array.isArray(value) &&
		value.length >= minimum &&
		value.length <= maximum &&
		value.every(predicate) &&
		new Set(value).size === value.length
	);
}

export function isRepositoryPath(value) {
	return (
		text(value, 500) &&
		!value.startsWith("/") &&
		!value.includes("\\") &&
		!/^[A-Za-z]:/.test(value) &&
		value
			.split("/")
			.every(
				(part) =>
					part &&
					part !== "." &&
					part !== ".." &&
					!protectedSegments.has(part) &&
					(!(part === ".env" || part.startsWith(".env.")) ||
						[".env.example", ".env.sample"].includes(part)),
			)
	);
}

function requiredPath(value) {
	return isRepositoryPath(value) && !value.startsWith("docs/integration-evidence/");
}

export function isHttpsOrigin(value) {
	if (!text(value, 2048)) return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			!url.port &&
			url.origin === value
		);
	} catch {
		return false;
	}
}

function siteKey(value) {
	return (
		text(value, 253) &&
		value === value.toLowerCase() &&
		!value.startsWith("www.") &&
		value.includes(".") &&
		!value.split(".").every((label) => /^\d+$/.test(label)) &&
		value.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))
	);
}

function tenantId(value) {
	return (
		value === null ||
		(typeof value === "string" &&
			/^tenant_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value))
	);
}

function publicPath(value) {
	return (
		text(value, 500) &&
		value.startsWith("/") &&
		!value.startsWith("//") &&
		!/[?#\\%]/.test(value) &&
		!value.split("/").some((part) => part === "." || part === "..")
	);
}

function evidenceShape(value) {
	if (
		!exactKeys(value, [
			"verifiedAt",
			"environmentId",
			"siteUrl",
			"tenantId",
			"sourceFingerprint",
			"contractFingerprint",
			"evidenceFile",
			"checks",
			"releaseRecord",
			"deploymentObservation",
		])
	)
		return false;
	const date = typeof value.verifiedAt === "string" ? Date.parse(value.verifiedAt) : NaN;
	return (
		Number.isFinite(date) &&
		new Date(date).toISOString() === value.verifiedAt &&
		typeof value.environmentId === "string" &&
		identifier.test(value.environmentId) &&
		siteKey(value.siteUrl) &&
		tenantId(value.tenantId) &&
		typeof value.sourceFingerprint === "string" &&
		fingerprintPattern.test(value.sourceFingerprint) &&
		typeof value.contractFingerprint === "string" &&
		fingerprintPattern.test(value.contractFingerprint) &&
		isRepositoryPath(value.evidenceFile) &&
		value.evidenceFile.startsWith("docs/integration-evidence/") &&
		record(value.checks) &&
		Object.entries(value.checks).every(
			([id, outcome]) =>
				/^[A-Za-z][A-Za-z0-9]*\.[a-z][a-z0-9-]{0,79}$/.test(id) &&
				["passed", "unavailable"].includes(outcome),
		) &&
		[value.releaseRecord, value.deploymentObservation].every(
			(item) => item === null || text(item, 200),
		)
	);
}

/** Validate desired setup and evidence shape without interpreting observations as authority. */
export function validateContract(value) {
	const issues = [];
	const fail = (condition, message) => {
		if (!condition) issues.push(message);
	};
	if (
		!exactKeys(value, [
			"version",
			"repository",
			"tenant",
			"environments",
			"packages",
			"contracts",
			"environmentRequirements",
			"capabilities",
			"stages",
		]) ||
		value.version !== 2
	)
		return ["The setup contract must use the exact version 2 schema."];

	fail(
		typeof value.repository === "string" &&
			/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.repository) &&
			value.repository.length <= 200,
		"repository must identify an owner and repository name.",
	);
	fail(
		exactKeys(value.tenant, ["siteUrl", "expectedTenantId"]) &&
			siteKey(value.tenant.siteUrl) &&
			tenantId(value.tenant.expectedTenantId),
		"tenant must contain a canonical siteUrl and an expectedTenantId or null.",
	);

	const environmentIds = [];
	if (
		!Array.isArray(value.environments) ||
		value.environments.length < 1 ||
		value.environments.length > 8
	) {
		issues.push("environments must contain between one and eight explicit targets.");
	} else {
		for (const environment of value.environments) {
			if (
				!exactKeys(environment, [
					"id",
					"publicOrigin",
					"convexUrl",
					"convexSiteUrl",
					"cmsMediaOrigin",
					"publicPath",
				])
			) {
				issues.push("Each environment must use the declared target schema.");
				continue;
			}
			fail(
				typeof environment.id === "string" &&
					identifier.test(environment.id) &&
					!environmentIds.includes(environment.id),
				"Environment IDs must be valid and unique.",
			);
			environmentIds.push(environment.id);
			fail(
				isHttpsOrigin(environment.publicOrigin) && publicPath(environment.publicPath),
				"Each environment requires a canonical HTTPS publicOrigin and a rooted publicPath.",
			);
			const pair = [environment.convexUrl, environment.convexSiteUrl];
			fail(
				pair.every(isHttpsOrigin),
				"Convex origins must both be explicit canonical HTTPS origins.",
			);
			if (pair.every(isHttpsOrigin)) {
				const cloud = new URL(environment.convexUrl).hostname;
				fail(
					!cloud.endsWith(".convex.cloud") ||
						new URL(environment.convexSiteUrl).hostname ===
							cloud.replace(/\.convex\.cloud$/, ".convex.site"),
					"Convex origins must identify the same deployment.",
				);
			}
			fail(
				environment.cmsMediaOrigin === null || isHttpsOrigin(environment.cmsMediaOrigin),
				"cmsMediaOrigin must be a canonical HTTPS origin or null.",
			);
		}
	}

	fail(
		record(value.packages) &&
			Object.keys(value.packages).length >= 2 &&
			Object.keys(value.packages).length <= 30 &&
			["@jessepomeroy/admin", "@jessepomeroy/crm-api"].every((name) =>
				Object.hasOwn(value.packages, name),
			) &&
			Object.entries(value.packages).every(
				([name, version]) =>
					/^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name) &&
					typeof version === "string" &&
					exactVersion.test(version),
			),
		"packages must pin exact versions, including the shared Admin and CRM packages.",
	);
	fail(
		exactKeys(value.contracts, ["backend", "workers"]) &&
			uniqueList(value.contracts.backend, (item) => text(item, 200), 1) &&
			uniqueList(value.contracts.workers, (item) => text(item, 200)),
		"contracts must list explicit required backend and Worker contract identifiers.",
	);

	if (!exactKeys(value.capabilities, capabilityIds)) {
		issues.push("capabilities must declare every supported capability exactly once.");
	} else {
		for (const id of capabilityIds) {
			const capability = value.capabilities[id];
			if (!exactKeys(capability, ["status", "reason", "requiredFiles", "checks"])) {
				issues.push(`${id}: capability schema is invalid.`);
				continue;
			}
			fail(
				["included", "excluded"].includes(capability.status),
				`${id}: declare included or excluded.`,
			);
			fail(
				typeof capability.reason === "string" &&
					(capability.reason === "" ? capability.status === "included" : text(capability.reason)),
				`${id}: exclusions require an explicit reason.`,
			);
			fail(
				uniqueList(
					capability.requiredFiles,
					requiredPath,
					capability.status === "included" ? 1 : 0,
				),
				`${id}: requiredFiles must contain actual repository paths for included capabilities.`,
			);
			fail(
				Array.isArray(capability.checks) &&
					capability.checks.length >= 1 &&
					capability.checks.length <= 30 &&
					capability.checks.every(
						(check) =>
							exactKeys(check, ["id", "description"]) &&
							typeof check.id === "string" &&
							identifier.test(check.id) &&
							text(check.description),
					) &&
					new Set(capability.checks.map((check) => check?.id)).size === capability.checks.length,
				`${id}: named functional or unavailability checks are required.`,
			);
		}
		for (const [dependent, dependency] of [
			["privateCatalogAssets", "catalog"],
			["commerce", "catalog"],
		]) {
			fail(
				value.capabilities[dependent]?.status !== "included" ||
					value.capabilities[dependency]?.status === "included",
				`${dependent}: the catalog capability must also be included.`,
			);
		}
		if (
			["portfolio", "sitePages", "blog", "catalog"].some(
				(id) => value.capabilities[id]?.status === "included",
			)
		) {
			fail(
				Array.isArray(value.environments) &&
					value.environments.every((item) => isHttpsOrigin(item?.cmsMediaOrigin)),
				"Included CMS media capabilities require an explicit cmsMediaOrigin in every environment.",
			);
		}
	}

	if (!Array.isArray(value.environmentRequirements) || value.environmentRequirements.length > 100) {
		issues.push("environmentRequirements must be an explicit bounded list.");
	} else {
		const keys = new Set();
		for (const requirement of value.environmentRequirements) {
			if (
				!exactKeys(requirement, [
					"name",
					"purpose",
					"service",
					"phase",
					"sensitive",
					"capabilities",
				])
			) {
				issues.push(
					"Environment requirements must use the declared descriptor schema; values are forbidden.",
				);
				continue;
			}
			const key = `${requirement.service}:${requirement.name}`;
			fail(
				typeof requirement.name === "string" &&
					/^[A-Z][A-Z0-9_]{0,99}$/.test(requirement.name) &&
					text(requirement.purpose) &&
					ENVIRONMENT_SERVICES.includes(requirement.service) &&
					["build", "runtime"].includes(requirement.phase) &&
					typeof requirement.sensitive === "boolean" &&
					!(requirement.sensitive && requirement.name.startsWith("PUBLIC_")) &&
					uniqueList(requirement.capabilities, (id) => capabilityIds.includes(id)) &&
					!keys.has(key),
				"Environment descriptors must be unique, purpose-scoped, and contain valid names and capabilities.",
			);
			keys.add(key);
		}
	}

	if (
		!Array.isArray(value.stages) ||
		value.stages.length !== STAGE_IDS.length ||
		STAGE_IDS.some((id) => value.stages.filter((stage) => stage?.id === id).length !== 1)
	) {
		issues.push("The integration record must contain all six stages exactly once.");
	} else {
		for (const stage of value.stages) {
			if (!exactKeys(stage, ["id", "requiredFiles", "verification"])) {
				issues.push("Each stage must use the requiredFiles and verification schema.");
				continue;
			}
			fail(
				uniqueList(
					stage.requiredFiles,
					requiredPath,
					["backend", "tenant", "handoff"].includes(stage.id) ? 1 : 0,
				),
				`${stage.id}: requiredFiles must contain safe, explicit local paths.`,
			);
			fail(
				exactKeys(stage.verification, environmentIds) &&
					Object.values(stage.verification).every((item) => item === null || evidenceShape(item)),
				`${stage.id}: verification must record each environment separately using the evidence schema.`,
			);
		}
	}
	return issues;
}

export function assertContract(value) {
	const issues = validateContract(value);
	if (issues.length) throw new Error(`Invalid client setup contract: ${issues.join(" ")}`);
	return value;
}

export function getEnvironment(contract, id) {
	assertContract(contract);
	const environment = contract.environments.find((item) => item.id === id);
	if (!environment)
		throw new Error("The requested environment is not declared in the setup contract.");
	return environment;
}

function canonical(value) {
	if (Array.isArray(value)) return value.map(canonical);
	if (record(value))
		return Object.fromEntries(
			Object.keys(value)
				.sort()
				.map((key) => [key, canonical(value[key])]),
		);
	return value;
}

export function contractFingerprint(contract) {
	assertContract(contract);
	const desired = {
		...contract,
		stages: contract.stages.map(({ verification: _verification, ...stage }) => stage),
	};
	return createHash("sha256")
		.update(JSON.stringify(canonical(desired)))
		.digest("hex");
}

/** New installations start pending even when the supplied example carries old evidence. */
export function createPendingManifest(contract) {
	const pending = structuredClone(contract);
	if (Array.isArray(pending?.stages) && Array.isArray(pending?.environments)) {
		for (const stage of pending.stages) {
			if (record(stage))
				stage.verification = Object.fromEntries(
					pending.environments.map((item) => [item?.id, null]),
				);
		}
	}
	return assertContract(pending);
}
