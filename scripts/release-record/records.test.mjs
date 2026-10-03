import assert from "node:assert/strict";
import test from "node:test";
import {
	assertReleaseRecord,
	createReleaseRecord,
	deriveReleaseStatus,
	fingerprintPublicConfig,
} from "./records.mjs";

const identity = {
	repository: "JessePomeroy/angelsrest",
	siteUrl: "angelsrest.online",
	environmentId: "production",
	contractFingerprint: null,
};
const publicConfig = {
	publicOrigin: "https://www.angelsrest.online",
	convexUrl: "https://fixture.convex.cloud",
	convexSiteUrl: "https://fixture.convex.site",
	cmsMediaOrigin: null,
	checkoutSnapshotMode: "handle-v2",
	mutationTransport: "http",
};
const requiredChecks = [
	{ id: "navigation", scope: "public" },
	{ id: "navigation", scope: "client-ui" },
];
const target = { ...identity, publicOrigin: publicConfig.publicOrigin, requiredChecks };
delete target.contractFingerprint;
const at = (minute) => new Date(Date.UTC(2026, 0, 1, 0, minute)).toISOString();
const evidenceRef = "docs/integration-evidence/release.md";
const capabilityValues = (value) => ({
	portfolio: value,
	sitePages: value,
	blog: value,
	catalog: value,
	privateCatalogAssets: value,
	crm: value,
	delivery: value,
	commerce: value,
});

function buildInput() {
	return {
		kind: "build",
		identity: { ...identity },
		observedAt: at(1),
		data: {
			sourceRevision: "a".repeat(40),
			sourceFingerprint: null,
			packages: [
				{ name: "@jessepomeroy/admin", version: "6.7.1", source: "installed" },
				{ name: "@jessepomeroy/crm-api", version: "6.6.0", source: "workspace" },
				{ name: "@jessepomeroy/print-catalog", version: "1.0.0", source: "workspace" },
				{ name: "@jessepomeroy/gallery-delivery", version: "1.0.0", source: "workspace" },
			],
			lockfileDigest: "1".repeat(64),
			scope: "ci-fixture",
			publicConfig: { ...publicConfig },
			configFingerprint: fingerprintPublicConfig(publicConfig),
			requiredContracts: {
				backend: ["crm-api@6.6.0"],
				workers: [
					{
						id: "gallery-artwork-contract",
						repository: "JessePomeroy/gallery-worker",
						sourceRevision: "c".repeat(40),
					},
					{
						id: "cms-media-editor-and-deletion",
						repository: "JessePomeroy/gallery-worker",
						sourceRevision: null,
					},
					{ id: "managed-turnstile-siteverify", repository: null, sourceRevision: null },
				],
			},
			github: {
				runId: "37117568598",
				runAttempt: 1,
				event: "pull_request",
				ref: "refs/pull/701/merge",
				headSha: "b".repeat(40),
				workflow: ".github/workflows/ci.yml",
			},
			checks: {
				dependency_install: "success",
				worker_checkout: "success",
				worker_install: "success",
				lint: "success",
				typecheck: "success",
				tests: "success",
				retired_checkout: "success",
				build: "success",
				component_browser: "success",
				e2e: "success",
			},
			output: { scope: "static-client-assets", digest: "2".repeat(64), fileCount: 5, bytes: 1234 },
		},
	};
}
function build(change = () => {}) {
	const input = buildInput();
	change(input);
	return createReleaseRecord(input);
}
function deployment(parent, data = {}, minute = 2) {
	return createReleaseRecord({
		kind: "deployment",
		identity: parent.identity,
		observedAt: at(minute),
		data: {
			buildRecordId: parent.recordId,
			provider: "vercel",
			accountId: "team_fixture",
			projectId: "prj_fixture",
			deploymentId: "dpl_first",
			url: "https://fixture.vercel.app",
			target: "production",
			status: "READY",
			sourceRevision: parent.data.sourceRevision,
			configFingerprint: null,
			binding: "source-only",
			aliases: [{ hostname: "www.angelsrest.online", assigned: true }],
			...data,
		},
	});
}
function verification(parent, checks = requiredChecks, minute = 3, result = "passed") {
	return createReleaseRecord({
		kind: "verification",
		identity: parent.identity,
		observedAt: at(minute),
		data: {
			deploymentRecordId: parent.recordId,
			configFingerprint: parent.data.configFingerprint,
			checks: checks.map((check) => ({ ...check, result, evidenceRef })),
		},
	});
}
function capabilities(parent, minute = 3) {
	return createReleaseRecord({
		kind: "capabilities",
		identity: parent.identity,
		observedAt: at(minute),
		data: {
			deploymentRecordId: parent.recordId,
			values: capabilityValues("unknown"),
			evidenceRefs: [evidenceRef],
		},
	});
}
function intended(parent, sourceRevision = parent.data.sourceRevision) {
	return createReleaseRecord({
		kind: "intended",
		identity: parent.identity,
		observedAt: at(0),
		data: {
			sourceRevision,
			packages: parent.data.packages,
			capabilities: capabilityValues("included"),
			requiredContracts: parent.data.requiredContracts,
			reviewRef: "https://github.com/JessePomeroy/angelsrest/pull/701",
		},
	});
}
function invalid(operation) {
	assert.throws(operation, (error) => {
		assert.equal(error.message, "Invalid release record or history.");
		return true;
	});
}

test("content IDs survive object-key reordering, detect tampering and do not retain mutable caller state", () => {
	const input = buildInput();
	const recorded = createReleaseRecord(input);
	const reversed = (value) =>
		Array.isArray(value)
			? value.map(reversed)
			: value !== null && typeof value === "object"
				? Object.fromEntries(
						Object.entries(value)
							.reverse()
							.map(([key, item]) => [key, reversed(item)]),
					)
				: value;
	assert.deepEqual(createReleaseRecord(reversed(input)), recorded);
	assert.match(recorded.recordId, /^sha256:[a-f0-9]{64}$/);
	input.data.packages[0].version = "9.0.0";
	assert.equal(recorded.data.packages[0].version, "6.7.1");
	assert.equal(assertReleaseRecord(recorded), recorded);
	const changed = structuredClone(recorded);
	changed.data.packages[0].version = "9.0.0";
	invalid(() => assertReleaseRecord(changed));
	invalid(() => deriveReleaseStatus([recorded, changed], target));
	assert.deepEqual(
		deriveReleaseStatus([recorded, recorded], target),
		deriveReleaseStatus([recorded], target),
	);
});

test("closed records reject credential, customer and upload-receipt fields without echoing their values", () => {
	for (const change of [
		(value) => {
			value.customerEmail = "private-canary@example.test";
		},
		(value) => {
			value.identity.token = "private-canary";
		},
		(value) => {
			value.data.github.authorization = "private-canary";
		},
		(value) => {
			value.data.output.artifactId = "private-canary";
		},
		(value) => {
			value.data.publicConfig.WEBHOOK_SECRET = "private-canary";
		},
	]) {
		const input = buildInput();
		change(input);
		invalid(() => createReleaseRecord(input));
	}
	invalid(() => assertReleaseRecord({ ...build(), credentials: "private-canary" }));
});

test("public configuration hashes only the closed public fields and rejects credential-bearing endpoints", () => {
	const fingerprint = fingerprintPublicConfig(publicConfig);
	assert.notEqual(
		fingerprintPublicConfig({ ...publicConfig, cmsMediaOrigin: "https://media.example.test" }),
		fingerprint,
	);
	for (const origin of [
		"http://example.test",
		"https://private-canary@example.test",
		"https://example.test?token=private-canary",
		"https://example.test/#private-canary",
	]) {
		invalid(() => fingerprintPublicConfig({ ...publicConfig, publicOrigin: origin }));
	}
	invalid(() =>
		fingerprintPublicConfig({ ...publicConfig, convexSiteUrl: "https://other.convex.site" }),
	);
	invalid(() => fingerprintPublicConfig({ ...publicConfig, password: "private-canary" }));
	invalid(() =>
		build((value) => {
			value.data.configFingerprint = "f".repeat(64);
		}),
	);
});

test("client package sets keep exact installed/workspace versions without requiring unrelated optional packages", () => {
	const client = build((value) => {
		value.data.packages = value.data.packages.slice(0, 2);
		value.data.packages.push({
			name: "@client/editor",
			version: "1.2.3-beta.1",
			source: "installed",
		});
		value.data.requiredContracts.backend = ["Shared published content interface"];
		value.data.requiredContracts.workers = [
			{ id: "CMS upload and deletion", repository: null, sourceRevision: null },
		];
	});
	assert.equal(client.data.packages.length, 3);
	for (const change of [
		(value) => {
			value.data.packages[0].version = "^6.7.1";
		},
		(value) => {
			value.data.packages[0].name = "Private Canary";
		},
		(value) => {
			value.data.packages.splice(0, 1);
		},
		(value) => {
			value.data.packages.push(value.data.packages[0]);
		},
		(value) => {
			value.data.packages.push(
				...Array.from({ length: 27 }, (_, index) => ({
					name: `fixture-${index}`,
					version: "1.0.0",
					source: "installed",
				})),
			);
		},
	])
		invalid(() => build(change));
});

test("unknown Worker sources remain unknown and a source pin cannot lack its repository", () => {
	const observed = build();
	assert.equal(observed.data.requiredContracts.workers[1].sourceRevision, null);
	assert.equal(observed.data.requiredContracts.workers[2].repository, null);
	invalid(() =>
		build((value) => {
			value.data.requiredContracts.workers[0].repository = null;
		}),
	);
	assert.equal(deriveReleaseStatus([observed], target).lastHealthy, null);
});

test("builds, intent and provider readiness never imply live capability or client verification", () => {
	const built = build();
	const desired = intended(built, null);
	const deployed = deployment(built);
	const withoutIntent = deriveReleaseStatus([built, deployed], target);
	assert.equal(withoutIntent.intended, null);
	assert.equal(withoutIntent.capabilities, null);
	assert.equal(withoutIntent.verification.status, "unknown");
	assert.equal(withoutIntent.lastHealthy, null);
	const status = deriveReleaseStatus([desired, built, deployed, capabilities(deployed)], target);
	assert.equal(status.intended.recordId, desired.recordId);
	assert.equal(status.intended.data.sourceRevision, null);
	assert.equal(status.capabilities.data.values.commerce, "unknown");
	assert.equal(status.lastHealthy, null);
	assert.equal(status.history[0].configFingerprint, null);
	assert.equal(status.history[0].binding, "source-only");
});

test("healthy means all declared scopes passed for the exact deployment, with unknown runtime configuration retained", () => {
	const built = build();
	const deployed = deployment(built);
	const publicOnly = verification(deployed, requiredChecks.slice(0, 1));
	assert.equal(deriveReleaseStatus([built, deployed, publicOnly], target).lastHealthy, null);
	const clientUi = verification(deployed, requiredChecks.slice(1), 4);
	const status = deriveReleaseStatus([built, deployed, publicOnly, clientUi], target);
	assert.equal(status.lastHealthy.recordId, deployed.recordId);
	assert.equal(status.history[0].health, "healthy");
	assert.equal(status.verification.checks.length, 2);
	assert.equal(status.lastHealthy.data.configFingerprint, null);
	invalid(() =>
		deriveReleaseStatus([built, deployed, publicOnly, clientUi], { ...target, requiredChecks: [] }),
	);
	invalid(() =>
		deriveReleaseStatus([], { ...target, requiredChecks: [requiredChecks[0], requiredChecks[0]] }),
	);
	invalid(() => verification(deployed, [requiredChecks[0], requiredChecks[0]]));
});

test("missing, failed, skipped and cancelled build checks cannot become success through deployed checks", () => {
	invalid(() =>
		build((value) => {
			delete value.data.checks.e2e;
		}),
	);
	for (const result of ["failure", "cancelled", "skipped"]) {
		const built = build((value) => {
			value.data.checks.e2e = result;
		});
		const deployed = deployment(built);
		const status = deriveReleaseStatus([built, deployed, verification(deployed)], target);
		assert.equal(status.lastHealthy, null);
		assert.notEqual(status.history[0].health, "healthy");
	}
});

test("missing client assets remain unknown and impossible digest/count combinations are rejected", () => {
	const built = build((value) => {
		value.data.output = { scope: "static-client-assets", digest: null, fileCount: 0, bytes: 0 };
	});
	const deployed = deployment(built);
	const status = deriveReleaseStatus([built, deployed, verification(deployed)], target);
	assert.equal(status.lastHealthy, null);
	assert.equal(status.history[0].health, "unknown");
	for (const output of [
		{ scope: "static-client-assets", digest: null, fileCount: 1, bytes: 0 },
		{ scope: "static-client-assets", digest: "f".repeat(64), fileCount: 0, bytes: 0 },
		{ scope: "static-client-assets", digest: "f".repeat(64), fileCount: 1, bytes: -1 },
	])
		invalid(() =>
			build((value) => {
				value.data.output = output;
			}),
		);
});

test("deployment binding uses actual checkout source, not the pull request head or another record kind", () => {
	const built = build();
	invalid(() =>
		build((value) => {
			value.data.sourceRevision = null;
		}),
	);
	invalid(() => deployment(built, { sourceRevision: null }));
	assert.notEqual(built.data.sourceRevision, built.data.github.headSha);
	const wrong = deployment(built, { sourceRevision: built.data.github.headSha });
	invalid(() => deriveReleaseStatus([built, wrong], target));
	const desired = intended(built);
	const wrongParent = deployment(built, { buildRecordId: desired.recordId });
	invalid(() => deriveReleaseStatus([built, desired, wrongParent], target));
});

test("mixed sites, repositories, environments and linked contract identities fail closed", () => {
	const built = build();
	for (const [key, value] of [
		["siteUrl", "other.example.test"],
		["environmentId", "staging"],
		["repository", "Other/site"],
	]) {
		const other = build((input) => {
			input.identity[key] = value;
		});
		invalid(() => deriveReleaseStatus([built, other], target));
	}
	const otherContract = build((value) => {
		value.identity.contractFingerprint = "d".repeat(64);
	});
	const wrong = deployment(otherContract, { buildRecordId: built.recordId });
	invalid(() => deriveReleaseStatus([built, otherContract, wrong], target));
	const deployed = deployment(built);
	const checked = verification(deployed);
	const wrongCheck = createReleaseRecord({
		kind: checked.kind,
		identity: otherContract.identity,
		observedAt: checked.observedAt,
		data: checked.data,
	});
	invalid(() => deriveReleaseStatus([built, deployed, wrongCheck], target));
});

test("verification cannot predate its deployment or claim a different observed configuration", () => {
	const built = build();
	const tooEarly = deployment(built, {}, 0);
	invalid(() => deriveReleaseStatus([built, tooEarly], target));
	const deployed = deployment(built, { configFingerprint: "e".repeat(64) });
	invalid(() =>
		deriveReleaseStatus([built, deployed, verification(deployed, requiredChecks, 1)], target),
	);
	const checked = verification(deployed);
	const wrong = createReleaseRecord({
		kind: checked.kind,
		identity: checked.identity,
		observedAt: checked.observedAt,
		data: { ...checked.data, configFingerprint: null },
	});
	invalid(() => deriveReleaseStatus([built, deployed, wrong], target));
	invalid(() =>
		build((value) => {
			value.observedAt = new Date(Date.now() + 10 * 60_000).toISOString();
		}),
	);
	invalid(() =>
		build((value) => {
			value.observedAt = "2026-02-30T00:00:00.000Z";
		}),
	);
});

test("new candidates without alias evidence stay distinct from the currently observed deployment", () => {
	const built = build();
	const live = deployment(built);
	const candidate = deployment(built, { deploymentId: "dpl_candidate", aliases: [] }, 4);
	const status = deriveReleaseStatus([candidate, built, live], target);
	assert.equal(status.latestDeployment.recordId, candidate.recordId);
	assert.equal(status.currentDeployment.recordId, live.recordId);
	for (const assigned of [false, null]) {
		const observed = deployment(
			built,
			{ deploymentId: "dpl_candidate", aliases: [{ hostname: "www.angelsrest.online", assigned }] },
			5,
		);
		assert.equal(deriveReleaseStatus([live, observed, built], target).currentDeployment, null);
	}
	assert.equal(deriveReleaseStatus([built, candidate], target).currentDeployment, null);
});

test("a failed distinct upgrade retains prior scoped health across historical contract versions", () => {
	const original = build((value) => {
		value.identity.contractFingerprint = "d".repeat(64);
	});
	const previous = deployment(original);
	const checked = verification(previous);
	const upgrade = build((value) => {
		value.identity.contractFingerprint = "e".repeat(64);
		value.observedAt = at(4);
		value.data.sourceRevision = "c".repeat(40);
	});
	const failed = deployment(upgrade, { deploymentId: "dpl_upgrade", status: "ERROR" }, 5);
	const status = deriveReleaseStatus([failed, checked, original, previous, upgrade], target);
	assert.equal(status.currentDeployment.recordId, failed.recordId);
	assert.equal(status.lastHealthy.recordId, previous.recordId);
	assert.equal(status.history[0].health, "failed");
	assert.equal(status.capabilities, null);
});

test("a newer failing observation of the same physical deployment cannot reuse old health or capabilities", () => {
	const built = build();
	const previous = deployment(built);
	const checked = verification(previous);
	const enabled = capabilities(previous);
	const later = deployment(built, { aliases: [] }, 4);
	const failed = verification(later, requiredChecks, 5, "failed");
	const status = deriveReleaseStatus([built, previous, checked, enabled, later, failed], target);
	assert.equal(status.currentDeployment.recordId, later.recordId);
	assert.equal(status.verification.status, "failed");
	assert.equal(status.capabilities, null);
	assert.equal(status.lastHealthy, null);
	assert.equal(
		status.history.find((entry) => entry.deploymentRecordId === previous.recordId).health,
		"healthy",
	);
});

test("an uninformative poll preserves last known health without transferring proof to the current observation", () => {
	const built = build();
	const previous = deployment(built);
	const checked = verification(previous);
	const later = deployment(built, { aliases: [] }, 4);
	const status = deriveReleaseStatus(
		[built, previous, checked, capabilities(previous), later],
		target,
	);
	assert.equal(status.currentDeployment.recordId, later.recordId);
	assert.equal(status.verification.status, "unknown");
	assert.equal(status.capabilities, null);
	assert.equal(status.lastHealthy.recordId, previous.recordId);
});

test("a provider failure invalidates older proof and a later READY poll cannot erase the failure", () => {
	const built = build();
	const previous = deployment(built);
	const checked = verification(previous);
	const failed = deployment(built, { status: "ERROR" }, 4);
	const later = deployment(built, {}, 5);
	const records = [built, previous, checked, failed, later];
	assert.equal(deriveReleaseStatus(records, target).lastHealthy, null);
	const rechecked = verification(later, requiredChecks, 6);
	assert.equal(
		deriveReleaseStatus([...records, rechecked], target).lastHealthy.recordId,
		later.recordId,
	);
});

test("the same immutable provider deployment cannot claim a different source revision", () => {
	const original = build();
	const previous = deployment(original);
	const changed = build((value) => {
		value.data.sourceRevision = "c".repeat(40);
		value.observedAt = at(3);
	});
	const contradictory = deployment(changed, {}, 4);
	invalid(() => deriveReleaseStatus([original, previous, changed, contradictory], target));
});

test("new configuration observations of the same runtime keep verification unknown until rechecked", () => {
	const built = build();
	const previous = deployment(built, { configFingerprint: "d".repeat(64) });
	const checked = verification(previous);
	const later = deployment(built, { configFingerprint: "e".repeat(64) }, 4);
	const status = deriveReleaseStatus([built, previous, checked, later], target);
	assert.equal(status.currentDeployment.recordId, later.recordId);
	assert.equal(status.verification.status, "unknown");
	assert.equal(status.lastHealthy, null);
});

test("old verification never attaches to a different deployment and missing references cannot establish health", () => {
	const built = build();
	const previous = deployment(built);
	const checked = verification(previous);
	const current = deployment(built, { deploymentId: "dpl_new" }, 4);
	const status = deriveReleaseStatus([built, previous, checked, current], target);
	assert.equal(status.verification.status, "unknown");
	assert.equal(status.lastHealthy.recordId, previous.recordId);
	const unresolved = deriveReleaseStatus(
		[current, verification(current, requiredChecks, 5)],
		target,
	);
	assert.deepEqual(unresolved.unresolvedRecordIds, [current.recordId]);
	assert.equal(unresolved.lastHealthy, null);
});

test("later failed checks supersede earlier passes and equal-time contradictory observations stay unknown", () => {
	const built = build();
	const deployed = deployment(built);
	const passed = verification(deployed);
	const failed = verification(deployed, requiredChecks.slice(1), 4, "failed");
	assert.equal(deriveReleaseStatus([built, deployed, passed, failed], target).lastHealthy, null);
	const tied = verification(deployed, requiredChecks.slice(1), 3, "failed");
	const ambiguous = deriveReleaseStatus([built, deployed, passed, tied], target);
	assert.equal(ambiguous.verification.status, "unknown");
	assert.equal(ambiguous.lastHealthy, null);
	const otherAlias = deployment(built, { deploymentId: "dpl_tied" });
	assert.equal(deriveReleaseStatus([built, deployed, otherAlias], target).currentDeployment, null);
});

test("verification references reject raw logs, private capabilities, credentials and traversal", () => {
	const built = build();
	const deployed = deployment(built);
	const check = verification(deployed);
	for (const reference of [
		"customer private-canary logged in",
		"https://example.test/delivery/private-canary",
		"docs/../private.json",
		"docs/.env.json",
		"https://private-canary@github.com/JessePomeroy/angelsrest/actions/runs/1",
		"https://github.com/JessePomeroy/angelsrest/actions/runs/1?token=private-canary",
	]) {
		invalid(() =>
			createReleaseRecord({
				kind: check.kind,
				identity: check.identity,
				observedAt: check.observedAt,
				data: { ...check.data, checks: [{ ...check.data.checks[0], evidenceRef: reference }] },
			}),
		);
	}
});
