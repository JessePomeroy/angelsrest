import { createHash } from "node:crypto";

const kinds = ["intended", "build", "deployment", "capabilities", "verification"];
const capabilityNames = [
	"portfolio",
	"sitePages",
	"blog",
	"catalog",
	"privateCatalogAssets",
	"crm",
	"delivery",
	"commerce",
];
const requiredPackages = ["@jessepomeroy/admin", "@jessepomeroy/crm-api"];
const buildChecks = [
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
];
const verificationScopes = ["public", "anonymous-auth", "client-ui", "operator-api", "provider"];
const deploymentStates = [
	"READY",
	"ERROR",
	"CANCELED",
	"BUILDING",
	"QUEUED",
	"INITIALIZING",
	"UNKNOWN",
];
const publicConfigKeys = [
	"publicOrigin",
	"convexUrl",
	"convexSiteUrl",
	"cmsMediaOrigin",
	"checkoutSnapshotMode",
	"mutationTransport",
];
const hashPattern = /^[a-f0-9]{64}$/;
const revisionPattern = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const recordIdPattern = /^sha256:[a-f0-9]{64}$/;
const exactVersion =
	/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?(?:\+[0-9A-Za-z]+(?:[.-][0-9A-Za-z]+)*)?$/;

function invalid() {
	throw new Error("Invalid release record or history.");
}
function requireValid(condition) {
	if (!condition) invalid();
}
function record(value) {
	return (
		value !== null &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		[Object.prototype, null].includes(Object.getPrototypeOf(value))
	);
}
function keys(value, expected) {
	return (
		record(value) &&
		Object.keys(value).length === expected.length &&
		expected.every((key) => Object.hasOwn(value, key))
	);
}
function text(value, pattern, maximum = 200) {
	return (
		typeof value === "string" && value.length > 0 && value.length <= maximum && pattern.test(value)
	);
}
function hash(value) {
	return text(value, hashPattern, 64);
}
function nullableHash(value) {
	return value === null || hash(value);
}
function revision(value) {
	return text(value, revisionPattern, 64);
}
function recordId(value) {
	return text(value, recordIdPattern, 71);
}
function identifier(value) {
	return text(value, /^[A-Za-z0-9][A-Za-z0-9._:/@-]*$/);
}
function contractLabel(value) {
	return (
		typeof value === "string" &&
		value.length > 0 &&
		value.length <= 200 &&
		value.trim() === value &&
		[...value].every(
			(character) => character.charCodeAt(0) >= 32 && character.charCodeAt(0) !== 127,
		)
	);
}
function repository(value) {
	return text(value, /^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/);
}
function hostname(value) {
	return (
		typeof value === "string" &&
		value.length <= 253 &&
		value.split(".").length > 1 &&
		!value.split(".").every((part) => /^\d+$/.test(part)) &&
		value
			.split(".")
			.every((part) => part.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(part))
	);
}
function httpsOrigin(value) {
	if (typeof value !== "string" || value.length > 500) return false;
	try {
		const url = new URL(value);
		return (
			url.protocol === "https:" &&
			!url.username &&
			!url.password &&
			url.origin === value &&
			hostname(url.hostname)
		);
	} catch {
		return false;
	}
}
function timestamp(value) {
	if (!text(value, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, 24)) return false;
	const time = Date.parse(value);
	return (
		Number.isFinite(time) &&
		time >= 0 &&
		time <= Date.now() + 5 * 60_000 &&
		new Date(time).toISOString() === value
	);
}
function list(value, predicate, maximum = 64, minimum = 0) {
	return (
		Array.isArray(value) &&
		value.length >= minimum &&
		value.length <= maximum &&
		value.every(predicate)
	);
}
function unique(value, key = (entry) => entry) {
	return new Set(value.map(key)).size === value.length;
}
function canonical(value) {
	if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
	if (record(value))
		return `{${Object.keys(value)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`)
			.join(",")}}`;
	return JSON.stringify(value);
}
function digest(value) {
	return createHash("sha256").update(canonical(value)).digest("hex");
}

function identity(value) {
	return (
		keys(value, ["repository", "siteUrl", "environmentId", "contractFingerprint"]) &&
		repository(value.repository) &&
		hostname(value.siteUrl) &&
		!value.siteUrl.startsWith("www.") &&
		text(value.environmentId, /^[a-z][a-z0-9-]*$/, 80) &&
		nullableHash(value.contractFingerprint)
	);
}
function packages(value) {
	return (
		list(
			value,
			(entry) =>
				keys(entry, ["name", "version", "source"]) &&
				text(entry.name, /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/, 214) &&
				text(entry.version, exactVersion, 100) &&
				["installed", "workspace"].includes(entry.source),
			30,
			requiredPackages.length,
		) &&
		unique(value, (entry) => entry.name) &&
		requiredPackages.every((name) => value.some((entry) => entry.name === name))
	);
}
function contracts(value) {
	return (
		keys(value, ["backend", "workers"]) &&
		list(value.backend, contractLabel) &&
		unique(value.backend) &&
		list(
			value.workers,
			(worker) =>
				keys(worker, ["id", "repository", "sourceRevision"]) &&
				contractLabel(worker.id) &&
				(worker.repository === null || repository(worker.repository)) &&
				(worker.sourceRevision === null ||
					(worker.repository !== null && revision(worker.sourceRevision))),
		) &&
		unique(value.workers, (worker) => worker.id)
	);
}
function capabilityValues(value, states) {
	return (
		keys(value, capabilityNames) && Object.values(value).every((state) => states.includes(state))
	);
}
function evidenceReference(value) {
	if (typeof value !== "string" || value.length > 500) return false;
	if (/^(?:docs|artifacts)\/[A-Za-z0-9._/-]+\.(?:md|json|png|webp)$/.test(value)) {
		return value
			.split("/")
			.every((part) => part && part !== "." && part !== ".." && !part.startsWith(".env"));
	}
	try {
		const url = new URL(value);
		if (
			url.origin !== "https://github.com" ||
			url.username ||
			url.password ||
			url.search ||
			url.hash
		)
			return false;
		return /^\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/(?:actions\/runs\/[1-9]\d*(?:\/(?:attempts|artifacts)\/[1-9]\d*)?|pull\/[1-9]\d*|commit\/[a-f0-9]{40,64})$/.test(
			url.pathname,
		);
	} catch {
		return false;
	}
}

/** Only these public primitives may contribute to configuration identity. */
export function fingerprintPublicConfig(value) {
	requireValid(keys(value, publicConfigKeys));
	for (const key of ["publicOrigin", "convexUrl", "convexSiteUrl", "cmsMediaOrigin"]) {
		requireValid(value[key] === null || httpsOrigin(value[key]));
	}
	requireValid(
		[null, "handle-v2", "inline-v1"].includes(value.checkoutSnapshotMode) &&
			value.mutationTransport === "http",
	);
	if (value.convexUrl !== null && value.convexSiteUrl !== null) {
		const cloud = new URL(value.convexUrl).hostname;
		requireValid(
			!cloud.endsWith(".convex.cloud") ||
				new URL(value.convexSiteUrl).hostname === cloud.replace(/\.convex\.cloud$/, ".convex.site"),
		);
	}
	return digest(value);
}

function checkIdentity(value) {
	return (
		keys(value, ["id", "scope"]) && identifier(value.id) && verificationScopes.includes(value.scope)
	);
}
function checkKey(value) {
	return `${value.scope}:${value.id}`;
}
function validData(kind, data) {
	if (kind === "intended") {
		return (
			keys(data, [
				"sourceRevision",
				"packages",
				"capabilities",
				"requiredContracts",
				"reviewRef",
			]) &&
			(data.sourceRevision === null || revision(data.sourceRevision)) &&
			packages(data.packages) &&
			contracts(data.requiredContracts) &&
			capabilityValues(data.capabilities, ["included", "excluded"]) &&
			evidenceReference(data.reviewRef)
		);
	}
	if (kind === "build") {
		if (
			!keys(data, [
				"sourceRevision",
				"sourceFingerprint",
				"packages",
				"lockfileDigest",
				"scope",
				"publicConfig",
				"configFingerprint",
				"requiredContracts",
				"github",
				"checks",
				"output",
			])
		)
			return false;
		const github = data.github;
		const output = data.output;
		return (
			revision(data.sourceRevision) &&
			nullableHash(data.sourceFingerprint) &&
			packages(data.packages) &&
			hash(data.lockfileDigest) &&
			["ci-fixture", "configured-release"].includes(data.scope) &&
			hash(data.configFingerprint) &&
			data.configFingerprint === fingerprintPublicConfig(data.publicConfig) &&
			contracts(data.requiredContracts) &&
			keys(github, ["runId", "runAttempt", "event", "ref", "headSha", "workflow"]) &&
			text(github.runId, /^[1-9]\d*$/, 30) &&
			Number.isSafeInteger(github.runAttempt) &&
			github.runAttempt > 0 &&
			text(github.event, /^[a-z][a-z0-9_]*$/, 80) &&
			text(github.ref, /^refs\/(?:heads|tags|pull)\/[A-Za-z0-9][A-Za-z0-9._/-]*$/, 250) &&
			!github.ref.includes("..") &&
			!github.ref.includes("//") &&
			!github.ref.endsWith("/") &&
			revision(github.headSha) &&
			text(github.workflow, /^\.github\/workflows\/[A-Za-z0-9._-]+\.ya?ml$/, 200) &&
			keys(data.checks, buildChecks) &&
			Object.values(data.checks).every((outcome) =>
				["success", "failure", "cancelled", "skipped"].includes(outcome),
			) &&
			keys(output, ["scope", "digest", "fileCount", "bytes"]) &&
			output.scope === "static-client-assets" &&
			nullableHash(output.digest) &&
			Number.isSafeInteger(output.fileCount) &&
			output.fileCount >= 0 &&
			Number.isSafeInteger(output.bytes) &&
			output.bytes >= 0 &&
			(output.digest === null ? output.fileCount === 0 && output.bytes === 0 : output.fileCount > 0)
		);
	}
	if (kind === "deployment") {
		return (
			keys(data, [
				"buildRecordId",
				"provider",
				"accountId",
				"projectId",
				"deploymentId",
				"url",
				"target",
				"status",
				"sourceRevision",
				"configFingerprint",
				"binding",
				"aliases",
			]) &&
			recordId(data.buildRecordId) &&
			data.provider === "vercel" &&
			[data.accountId, data.projectId, data.deploymentId].every((value) =>
				text(value, /^[A-Za-z0-9][A-Za-z0-9_-]*$/, 200),
			) &&
			httpsOrigin(data.url) &&
			text(data.target, /^[a-z][a-z0-9-]*$/, 80) &&
			deploymentStates.includes(data.status) &&
			revision(data.sourceRevision) &&
			nullableHash(data.configFingerprint) &&
			data.binding === "source-only" &&
			list(
				data.aliases,
				(alias) =>
					keys(alias, ["hostname", "assigned"]) &&
					hostname(alias.hostname) &&
					[true, false, null].includes(alias.assigned),
			) &&
			unique(data.aliases, (alias) => alias.hostname)
		);
	}
	if (kind === "capabilities") {
		return (
			keys(data, ["deploymentRecordId", "values", "evidenceRefs"]) &&
			recordId(data.deploymentRecordId) &&
			capabilityValues(data.values, ["enabled", "disabled", "unknown"]) &&
			list(data.evidenceRefs, evidenceReference, 20, 1) &&
			unique(data.evidenceRefs)
		);
	}
	if (kind === "verification") {
		return (
			keys(data, ["deploymentRecordId", "configFingerprint", "checks"]) &&
			recordId(data.deploymentRecordId) &&
			nullableHash(data.configFingerprint) &&
			list(
				data.checks,
				(check) =>
					keys(check, ["id", "scope", "result", "evidenceRef"]) &&
					identifier(check.id) &&
					verificationScopes.includes(check.scope) &&
					["passed", "failed", "blocked"].includes(check.result) &&
					evidenceReference(check.evidenceRef),
				64,
				1,
			) &&
			unique(data.checks, checkKey)
		);
	}
	return false;
}
function payload(value) {
	return {
		version: value.version,
		kind: value.kind,
		identity: value.identity,
		observedAt: value.observedAt,
		data: value.data,
	};
}
function assertPayload(value) {
	requireValid(
		value.version === 1 &&
			kinds.includes(value.kind) &&
			identity(value.identity) &&
			timestamp(value.observedAt) &&
			validData(value.kind, value.data),
	);
}

/** IDs cover the complete validated record, excluding only the ID itself. */
export function createReleaseRecord(input) {
	requireValid(keys(input, ["kind", "identity", "observedAt", "data"]));
	const value = { version: 1, ...input };
	assertPayload(value);
	return JSON.parse(canonical({ ...value, recordId: `sha256:${digest(value)}` }));
}

export function assertReleaseRecord(value) {
	requireValid(keys(value, ["version", "kind", "identity", "observedAt", "data", "recordId"]));
	assertPayload(value);
	requireValid(recordId(value.recordId) && value.recordId === `sha256:${digest(payload(value))}`);
	return value;
}

function sameIdentity(left, right) {
	return canonical(left) === canonical(right);
}
function physicalDeployment(value) {
	const { provider, accountId, projectId, deploymentId } = value.data;
	return canonical([provider, accountId, projectId, deploymentId]);
}
function newest(values) {
	if (values.length === 0) return null;
	const time = Math.max(...values.map((value) => Date.parse(value.observedAt)));
	const selected = values.filter((value) => Date.parse(value.observedAt) === time);
	// Equal-time contradictory observations do not have an authoritative order.
	return selected.length === 1 ? selected[0] : null;
}
function verificationFor(deployment, records, requiredChecks) {
	const observations = deployment
		? records.filter(
				(value) =>
					value.kind === "verification" && value.data.deploymentRecordId === deployment.recordId,
			)
		: [];
	const checks = requiredChecks.map((required) => {
		const candidates = observations.flatMap((observation) =>
			observation.data.checks
				.filter((check) => checkKey(check) === checkKey(required))
				.map((check) => ({
					observedAt: observation.observedAt,
					recordId: observation.recordId,
					...check,
				})),
		);
		const latest = newest(candidates);
		return (
			latest ?? {
				...required,
				result: "unknown",
				observedAt: null,
				recordId: null,
				evidenceRef: null,
			}
		);
	});
	const outcomes = checks.map((check) => check.result);
	const status = outcomes.includes("failed")
		? "failed"
		: outcomes.includes("blocked")
			? "blocked"
			: outcomes.length > 0 && outcomes.every((outcome) => outcome === "passed")
				? "passed"
				: "unknown";
	return { deploymentRecordId: deployment?.recordId ?? null, status, checks };
}
function scopedHealth(deployment, build, verification) {
	if (["ERROR", "CANCELED"].includes(deployment.data.status) || verification.status === "failed")
		return "failed";
	if (!build) return "unknown";
	const outcomes = Object.values(build.data.checks);
	if (outcomes.some((outcome) => ["failure", "cancelled"].includes(outcome))) return "failed";
	if (outcomes.includes("skipped") || verification.status === "blocked") return "blocked";
	if (build.data.output.digest === null) return "unknown";
	return deployment.data.status === "READY" &&
		outcomes.every((outcome) => outcome === "success") &&
		verification.status === "passed"
		? "healthy"
		: "unknown";
}

function healthStillApplies(candidate, observations, records, requiredChecks) {
	const latestKnownState = newest(observations.filter((value) => value.data.status !== "UNKNOWN"));
	if (latestKnownState?.data.status !== "READY") return false;
	const observed = candidate.deployment;
	const checks = candidate.verification.checks;
	for (const value of observations) {
		if (
			value.observedAt > observed.observedAt &&
			(!sameIdentity(value.identity, observed.identity) ||
				(value.data.configFingerprint !== null &&
					value.data.configFingerprint !== observed.data.configFingerprint))
		)
			return false;
		if (
			["ERROR", "CANCELED"].includes(value.data.status) &&
			checks.some((check) => check.observedAt <= value.observedAt)
		)
			return false;
	}
	const observationIds = new Set(observations.map((value) => value.recordId));
	const required = new Set(requiredChecks.map(checkKey));
	for (const value of records) {
		if (value.kind !== "verification" || !observationIds.has(value.data.deploymentRecordId))
			continue;
		for (const check of value.data.checks) {
			if (check.result !== "failed" || !required.has(checkKey(check))) continue;
			const proof = checks.find((entry) => checkKey(entry) === checkKey(check));
			if (proof.observedAt <= value.observedAt) return false;
		}
	}
	return true;
}

/** Health is scoped to explicit checks. It is never a client handoff or runtime-contract claim. */
export function deriveReleaseStatus(input, target) {
	requireValid(
		keys(target, ["repository", "siteUrl", "environmentId", "publicOrigin", "requiredChecks"]) &&
			identity({
				repository: target.repository,
				siteUrl: target.siteUrl,
				environmentId: target.environmentId,
				contractFingerprint: null,
			}) &&
			httpsOrigin(target.publicOrigin) &&
			list(target.requiredChecks, checkIdentity, 64, 1) &&
			unique(target.requiredChecks, checkKey),
	);
	requireValid(Array.isArray(input) && input.length <= 500);
	const recordsById = new Map();
	for (const value of input) {
		assertReleaseRecord(value);
		requireValid(
			["repository", "siteUrl", "environmentId"].every(
				(key) => value.identity[key] === target[key],
			),
		);
		const previous = recordsById.get(value.recordId);
		requireValid(!previous || canonical(previous) === canonical(value));
		recordsById.set(value.recordId, JSON.parse(canonical(value)));
	}
	const records = [...recordsById.values()];
	const unresolvedRecordIds = [];
	for (const value of records) {
		const parentId =
			value.kind === "deployment"
				? value.data.buildRecordId
				: ["capabilities", "verification"].includes(value.kind)
					? value.data.deploymentRecordId
					: null;
		if (parentId === null) continue;
		const parent = recordsById.get(parentId);
		if (!parent) {
			unresolvedRecordIds.push(value.recordId);
			continue;
		}
		requireValid(
			parent.kind === (value.kind === "deployment" ? "build" : "deployment") &&
				sameIdentity(parent.identity, value.identity) &&
				Date.parse(parent.observedAt) <= Date.parse(value.observedAt),
		);
		if (value.kind === "deployment")
			requireValid(value.data.sourceRevision === parent.data.sourceRevision);
		if (value.kind === "verification")
			requireValid(value.data.configFingerprint === parent.data.configFingerprint);
	}
	const deployments = records.filter((value) => value.kind === "deployment");
	const physicalDeployments = new Map();
	for (const value of deployments) {
		const key = physicalDeployment(value);
		const observations = physicalDeployments.get(key) ?? [];
		requireValid(
			observations.every((prior) => prior.data.sourceRevision === value.data.sourceRevision),
		);
		observations.push(value);
		physicalDeployments.set(key, observations);
	}
	const expectedHostname = new URL(target.publicOrigin).hostname;
	const alias = newest(
		deployments.flatMap((deployment) =>
			deployment.data.aliases
				.filter((entry) => entry.hostname === expectedHostname)
				.map((entry) => ({ ...entry, observedAt: deployment.observedAt, deployment })),
		),
	);
	const currentDeployment =
		alias?.assigned === true
			? newest(physicalDeployments.get(physicalDeployment(alias.deployment)))
			: null;
	const history = deployments
		.map((deployment) => {
			const build = recordsById.get(deployment.data.buildRecordId) ?? null;
			const verification = verificationFor(deployment, records, target.requiredChecks);
			return {
				deploymentRecordId: deployment.recordId,
				buildRecordId: deployment.data.buildRecordId,
				observedAt: deployment.observedAt,
				health: scopedHealth(deployment, build, verification),
				configFingerprint: deployment.data.configFingerprint,
				binding: deployment.data.binding,
				verification,
				capabilities: newest(
					records.filter(
						(value) =>
							value.kind === "capabilities" &&
							value.data.deploymentRecordId === deployment.recordId,
					),
				),
			};
		})
		.sort(
			(left, right) =>
				right.observedAt.localeCompare(left.observedAt) ||
				left.deploymentRecordId.localeCompare(right.deploymentRecordId),
		);
	// A new poll does not erase past proof. New contradictory runtime evidence does.
	const healthy = newest(
		history
			.filter((entry) => {
				if (entry.health !== "healthy") return false;
				const deployment = recordsById.get(entry.deploymentRecordId);
				return healthStillApplies(
					{ deployment, verification: entry.verification },
					physicalDeployments.get(physicalDeployment(deployment)),
					records,
					target.requiredChecks,
				);
			})
			.map((entry) => ({
				...entry,
				observedAt: entry.verification.checks
					.map((check) => check.observedAt)
					.sort()
					.at(-1),
			})),
	);
	return {
		identity: {
			repository: target.repository,
			siteUrl: target.siteUrl,
			environmentId: target.environmentId,
		},
		intended: newest(records.filter((value) => value.kind === "intended")),
		build: newest(records.filter((value) => value.kind === "build")),
		latestDeployment: newest(deployments),
		currentDeployment,
		capabilities: currentDeployment
			? history.find((entry) => entry.deploymentRecordId === currentDeployment.recordId)
					.capabilities
			: null,
		verification: verificationFor(currentDeployment, records, target.requiredChecks),
		lastHealthy: healthy ? recordsById.get(healthy.deploymentRecordId) : null,
		unresolvedRecordIds: unresolvedRecordIds.sort(),
		history,
	};
}
