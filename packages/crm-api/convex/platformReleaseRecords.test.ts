/// <reference types="vite/client" />
// @vitest-environment edge-runtime

import { createHash } from "node:crypto";
import { convexTest } from "convex-test";
import { describe, expect, test } from "vitest";
import { prepareReleaseImport } from "../src/releases/import";
import {
	createReleaseRecord,
	fingerprintPublicConfig,
	type DeploymentState,
	type ReleaseTarget,
} from "../src/releases/records.mjs";
import { api, internal } from "./_generated/api";
import { MAX_RELEASE_IMPORT_BYTES } from "./helpers/platformReleaseRecords";
import schema from "./schema";

const modules = import.meta.glob("./**/*.ts");
const owner = {
	subject: "creator",
	issuer: "https://fixture.convex.site",
	email: "creator@example.invalid",
	emailVerified: true,
};
const target: ReleaseTarget = {
	repository: "fixture/studio",
	siteUrl: "studio.example",
	environmentId: "production",
	publicOrigin: "https://studio.example",
	requiredChecks: [{ id: "http:/", scope: "public" }],
};
const epoch = Date.parse("2026-01-01T00:00:00.000Z");

function observation({
	version = "1.0.0",
	id = "dpl_fixtureA",
	revision = "a".repeat(40),
	status = "READY",
	offset = 0,
}: {
	version?: string;
	id?: string;
	revision?: string;
	status?: DeploymentState;
	offset?: number;
} = {}) {
	const observedAt = new Date(epoch + offset + 1000).toISOString();
	const identity = {
		repository: target.repository,
		siteUrl: target.siteUrl,
		environmentId: target.environmentId,
		contractFingerprint: null,
	};
	const publicConfig = {
		publicOrigin: target.publicOrigin,
		convexUrl: "https://fixture.convex.cloud",
		convexSiteUrl: "https://fixture.convex.site",
		cmsMediaOrigin: null,
		checkoutSnapshotMode: "handle-v2" as const,
		mutationTransport: "http" as const,
	};
	const build = createReleaseRecord<"build">({
		kind: "build",
		identity,
		observedAt: new Date(epoch + offset).toISOString(),
		data: {
			sourceRevision: revision,
			sourceFingerprint: null,
			packages: [
				{ name: "@jessepomeroy/admin", version, source: "installed" },
				{ name: "@jessepomeroy/crm-api", version: "1.0.0", source: "installed" },
			],
			lockfileDigest: "c".repeat(64),
			scope: "ci-fixture",
			publicConfig,
			configFingerprint: fingerprintPublicConfig(publicConfig),
			requiredContracts: { backend: ["fixture-contract"], workers: [] },
			github: {
				runId: "7",
				runAttempt: 1,
				event: "push",
				ref: "refs/heads/main",
				headSha: revision,
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
			output: { scope: "static-client-assets", digest: "d".repeat(64), fileCount: 1, bytes: 100 },
		},
	});
	const deployment = createReleaseRecord<"deployment">({
		kind: "deployment",
		identity,
		observedAt,
		data: {
			buildRecordId: build.recordId,
			provider: "vercel",
			accountId: "team_fixture",
			projectId: "prj_fixture",
			deploymentId: id,
			url: "https://fixture.vercel.app",
			target: "production",
			status,
			sourceRevision: revision,
			configFingerprint: null,
			binding: "source-only",
			aliases: [{ hostname: "studio.example", assigned: true }],
		},
	});
	const receipt = {
		version: 1,
		observedAt,
		buildRecordId: build.recordId,
		deploymentRecordId: deployment.recordId,
		artifact: {
			id: "11",
			digest: `sha256:${"e".repeat(64)}`,
			bytes: 1000,
			runId: "7",
			runAttempt: 1,
			url: "https://github.com/fixture/studio/actions/runs/7/artifacts/11",
		},
		provider: {
			accountId: "team_fixture",
			projectId: "prj_fixture",
			deploymentId: id,
			aliasStableDuringChecks: true,
		},
		publicChecks: [{ path: "/", status: 200, html: true, result: "passed" }],
	};
	const receiptName = `observation-${createHash("sha256").update(JSON.stringify(receipt)).digest("hex")}.json`;
	const verification = createReleaseRecord<"verification">({
		kind: "verification",
		identity,
		observedAt,
		data: {
			deploymentRecordId: deployment.recordId,
			configFingerprint: null,
			checks: [
				{
					id: "http:/",
					scope: "public",
					result: "passed",
					evidenceRef: `docs/integration-evidence/releases/production/${receiptName}`,
				},
			],
		},
	});
	return {
		build,
		deployment,
		verification,
		evidenceJson: JSON.stringify({
			records: [build, deployment, verification],
			receipts: [{ name: receiptName, value: receipt }],
		}),
		receiptName,
		receipt,
	};
}

async function setup() {
	const t = convexTest(schema, modules);
	const clientId = await t.run(async (ctx) => {
		await ctx.db.insert("platformClients", {
			name: "Hub",
			email: owner.email,
			siteUrl: "angelsrest.online",
			tier: "full",
			role: "creator",
			subscriptionStatus: "none",
			adminEmails: [owner.email],
			adminIdentityIds: [`${owner.issuer}|${owner.subject}`],
		});
		return await ctx.db.insert("platformClients", {
			name: "Fixture Studio",
			email: "client@example.invalid",
			siteUrl: target.siteUrl,
			tier: "basic",
			role: "client",
			subscriptionStatus: "none",
			adminEmails: ["client@example.invalid"],
		});
	});
	return { t, clientId };
}

describe("operator release evidence", () => {
	test("only a stored creator can read the projection; absence remains empty", async () => {
		const { t } = await setup();
		await expect(
			t.query(api.platformReleaseRecords.forSite, { siteUrl: target.siteUrl }),
		).rejects.toThrow("Not authenticated");
		await expect(
			t
				.withIdentity({ ...owner, subject: "client", email: "client@example.invalid" })
				.query(api.platformReleaseRecords.forSite, { siteUrl: target.siteUrl }),
		).rejects.toThrow("not a creator");
		expect(
			await t
				.withIdentity(owner)
				.query(api.platformReleaseRecords.forSite, { siteUrl: target.siteUrl }),
		).toEqual({ siteUrl: target.siteUrl, environments: [] });
	});

	test("stores real-shaped linked evidence and returns only the small scoped projection", async () => {
		const { t } = await setup();
		const fixture = observation();
		expect(
			await t.action(internal.platformReleaseRecordsNode.importObservation, {
				target,
				evidenceJson: fixture.evidenceJson,
			}),
		).toEqual({ changed: true, version: 1 });
		const result = await t
			.withIdentity(owner)
			.query(api.platformReleaseRecords.forSite, { siteUrl: target.siteUrl });
		expect(result.environments).toHaveLength(1);
		expect(result.environments[0].summary).toMatchObject({
			currentDeployment: { deploymentId: "dpl_fixtureA" },
			lastHealthy: { deploymentId: "dpl_fixtureA" },
			currentHealth: "healthy",
			currentBuild: {
				scope: "ci-fixture",
				packages: [
					{ name: "@jessepomeroy/admin", version: "1.0.0" },
					{ name: "@jessepomeroy/crm-api", version: "1.0.0" },
				],
			},
			intended: null,
			verification: { status: "passed" },
			compatibility: {
				versions: "unknown",
				source: "unknown",
				contract: "unknown",
				runtime: "unknown",
			},
			configurationObserved: false,
			capabilitiesObserved: false,
			nextAction: "record-intent",
		});
		expect(JSON.stringify(result)).not.toContain("evidenceJson");
		expect(JSON.stringify(result)).not.toContain("accountId");
	});

	test.each([
		{
			version: "1.0.0",
			revision: "a".repeat(40),
			versions: "match",
			source: "match",
			action: "verify-runtime",
		},
		{
			version: "2.0.0",
			revision: "a".repeat(40),
			versions: "mismatch",
			source: "match",
			action: "align-release",
		},
		{
			version: "1.0.0",
			revision: "b".repeat(40),
			versions: "match",
			source: "mismatch",
			action: "align-release",
		},
	])("compares reviewed intent with the actual deployment: $versions / $source", async ({
		version,
		revision,
		versions,
		source,
		action,
	}) => {
		const { t } = await setup();
		const fixture = observation();
		await t.action(internal.platformReleaseRecordsNode.importObservation, {
			target,
			evidenceJson: fixture.evidenceJson,
		});
		const intended = createReleaseRecord<"intended">({
			kind: "intended",
			identity: fixture.build.identity,
			observedAt: new Date(epoch + 2000).toISOString(),
			data: {
				sourceRevision: revision,
				packages: [
					{ name: "@jessepomeroy/admin", version, source: "installed" },
					{ name: "@jessepomeroy/crm-api", version: "1.0.0", source: "installed" },
				],
				capabilities: {
					portfolio: "included",
					sitePages: "included",
					blog: "excluded",
					catalog: "excluded",
					privateCatalogAssets: "excluded",
					crm: "included",
					delivery: "excluded",
					commerce: "excluded",
				},
				requiredContracts: { backend: ["fixture-contract"], workers: [] },
				reviewRef: "https://github.com/fixture/studio/pull/1",
			},
		});
		await t.action(internal.platformReleaseRecordsNode.importObservation, {
			target,
			evidenceJson: JSON.stringify({ records: [intended], receipts: [] }),
		});
		const result = await t
			.withIdentity(owner)
			.query(api.platformReleaseRecords.forSite, { siteUrl: target.siteUrl });
		expect(result.environments[0].summary).toMatchObject({
			intended: { recordId: intended.recordId },
			compatibility: { versions, source, contract: "unknown", runtime: "unknown" },
			nextAction: action,
		});
	});

	test("duplicate imports preserve the evidence version and observation time", async () => {
		const { t } = await setup();
		const input = { target, evidenceJson: observation().evidenceJson };
		await t.action(internal.platformReleaseRecordsNode.importObservation, input);
		const before = await t.query(internal.platformReleaseRecords.snapshot, {
			siteUrl: target.siteUrl,
			environmentId: target.environmentId,
		});
		expect(await t.action(internal.platformReleaseRecordsNode.importObservation, input)).toEqual({
			changed: false,
			version: 1,
		});
		expect(
			await t.query(internal.platformReleaseRecords.snapshot, {
				siteUrl: target.siteUrl,
				environmentId: target.environmentId,
			}),
		).toEqual(before);
	});

	test("object-key reordering is an idempotent replay while changed content is rejected", async () => {
		const { t } = await setup();
		const fixture = observation();
		await t.action(internal.platformReleaseRecordsNode.importObservation, {
			target,
			evidenceJson: fixture.evidenceJson,
		});
		const before = await t.query(internal.platformReleaseRecords.snapshot, {
			siteUrl: target.siteUrl,
			environmentId: target.environmentId,
		});
		function reorder(value: unknown): unknown {
			if (Array.isArray(value)) return value.map(reorder);
			if (value !== null && typeof value === "object")
				return Object.fromEntries(
					Object.entries(value)
						.reverse()
						.map(([key, entry]) => [key, reorder(entry)]),
				);
			return value;
		}
		const reordered = JSON.stringify({
			records: [fixture.build, fixture.deployment, fixture.verification].map(reorder),
			receipts: [{ name: fixture.receiptName, value: fixture.receipt }],
		});
		expect(
			await t.action(internal.platformReleaseRecordsNode.importObservation, {
				target,
				evidenceJson: reordered,
			}),
		).toEqual({ changed: false, version: 1 });
		expect(
			await t.query(internal.platformReleaseRecords.snapshot, {
				siteUrl: target.siteUrl,
				environmentId: target.environmentId,
			}),
		).toEqual(before);
		fixture.build.data.packages[0].version = "9.0.0";
		await expect(
			t.action(internal.platformReleaseRecordsNode.importObservation, {
				target,
				evidenceJson: JSON.stringify({
					records: [fixture.build],
					receipts: [{ name: fixture.receiptName, value: fixture.receipt }],
				}),
			}),
		).rejects.toThrow("Invalid release record");
		expect(
			await t.query(internal.platformReleaseRecords.snapshot, {
				siteUrl: target.siteUrl,
				environmentId: target.environmentId,
			}),
		).toEqual(before);
	});

	test("missing proof, a foreign target or excessive data cannot leave partial history", async () => {
		const { t } = await setup();
		const fixture = observation();
		for (const evidenceJson of [
			JSON.stringify({ records: [fixture.build, fixture.deployment], receipts: [] }),
			" ".repeat(MAX_RELEASE_IMPORT_BYTES + 1),
		]) {
			await expect(
				t.action(internal.platformReleaseRecordsNode.importObservation, { target, evidenceJson }),
			).rejects.toThrow();
		}
		await expect(
			t.action(internal.platformReleaseRecordsNode.importObservation, {
				target: { ...target, repository: "foreign/studio" },
				evidenceJson: fixture.evidenceJson,
			}),
		).rejects.toThrow();
		expect(await t.run((ctx) => ctx.db.query("platformReleaseEnvironments").take(1))).toEqual([]);
		expect(await t.run((ctx) => ctx.db.query("platformReleaseHistory").take(1))).toEqual([]);
	});

	test("a newer unbound build never replaces the running deployment's displayed packages", async () => {
		const { t } = await setup();
		await t.action(internal.platformReleaseRecordsNode.importObservation, {
			target,
			evidenceJson: observation().evidenceJson,
		});
		const newer = observation({
			version: "2.0.0",
			id: "dpl_fixtureB",
			revision: "b".repeat(40),
			offset: 5000,
		});
		await t.action(internal.platformReleaseRecordsNode.importObservation, {
			target,
			evidenceJson: JSON.stringify({
				records: [newer.build],
				receipts: [{ name: newer.receiptName, value: newer.receipt }],
			}),
		});
		const result = await t
			.withIdentity(owner)
			.query(api.platformReleaseRecords.forSite, { siteUrl: target.siteUrl });
		expect(result.environments[0].summary.currentBuild?.packages[0].version).toBe("1.0.0");
		expect(result.environments[0].summary.currentDeployment?.deploymentId).toBe("dpl_fixtureA");
	});

	test("a failed upgrade retains the previous scoped healthy deployment", async () => {
		const { t } = await setup();
		await t.action(internal.platformReleaseRecordsNode.importObservation, {
			target,
			evidenceJson: observation().evidenceJson,
		});
		await t.action(internal.platformReleaseRecordsNode.importObservation, {
			target,
			evidenceJson: observation({
				id: "dpl_fixtureB",
				revision: "b".repeat(40),
				status: "ERROR",
				offset: 5000,
			}).evidenceJson,
		});
		const result = await t
			.withIdentity(owner)
			.query(api.platformReleaseRecords.forSite, { siteUrl: target.siteUrl });
		expect(result.environments[0].summary).toMatchObject({
			currentHealth: "failed",
			lastHealthy: { deploymentId: "dpl_fixtureA" },
			nextAction: "investigate-release",
		});
	});

	test("a concurrent append cannot overwrite evidence observed after the action's read", async () => {
		const { t, clientId } = await setup();
		await t.action(internal.platformReleaseRecordsNode.importObservation, {
			target,
			evidenceJson: observation().evidenceJson,
		});
		const prior = await t.query(internal.platformReleaseRecords.snapshot, {
			siteUrl: target.siteUrl,
			environmentId: target.environmentId,
		});
		const incoming = observation({ id: "dpl_fixtureB", revision: "b".repeat(40), offset: 5000 });
		const stale = prepareReleaseImport(
			prior.history?.evidenceJson ?? null,
			incoming.evidenceJson,
			target,
		);
		await t.action(internal.platformReleaseRecordsNode.importObservation, {
			target,
			evidenceJson: observation({ id: "dpl_fixtureC", revision: "f".repeat(40), offset: 10000 })
				.evidenceJson,
		});
		await expect(
			t.mutation(internal.platformReleaseRecords.commit, {
				clientId,
				target,
				expectedVersion: 1,
				...stale,
			}),
		).rejects.toThrow("Release history changed");
		expect(
			await t.action(internal.platformReleaseRecordsNode.importObservation, {
				target,
				evidenceJson: incoming.evidenceJson,
			}),
		).toEqual({ changed: true, version: 3 });
		const saved = await t.query(internal.platformReleaseRecords.snapshot, {
			siteUrl: target.siteUrl,
			environmentId: target.environmentId,
		});
		expect(saved.history?.evidenceJson).toContain("dpl_fixtureA");
		expect(saved.history?.evidenceJson).toContain("dpl_fixtureB");
		expect(saved.history?.evidenceJson).toContain("dpl_fixtureC");
	});

	test("a changed policy, origin or client ownership cannot silently reinterpret proof", async () => {
		const { t, clientId } = await setup();
		const evidenceJson = observation().evidenceJson;
		await t.action(internal.platformReleaseRecordsNode.importObservation, { target, evidenceJson });
		for (const changed of [
			{ ...target, publicOrigin: "https://different.example" },
			{ ...target, requiredChecks: [{ id: "http:/cart", scope: "public" as const }] },
		]) {
			await expect(
				t.action(internal.platformReleaseRecordsNode.importObservation, {
					target: changed,
					evidenceJson,
				}),
			).rejects.toThrow("explicit migration");
		}
		await t.run((ctx) => ctx.db.patch(clientId, { siteUrl: "renamed.example" }));
		await expect(
			t
				.withIdentity(owner)
				.query(api.platformReleaseRecords.forSite, { siteUrl: "renamed.example" }),
		).rejects.toThrow("ownership changed");
	});

	test("corrupt retained bytes stop an import without replacing the previous history", async () => {
		const { t } = await setup();
		const evidenceJson = observation().evidenceJson;
		await t.action(internal.platformReleaseRecordsNode.importObservation, { target, evidenceJson });
		await t.run(async (ctx) => {
			const history = (await ctx.db.query("platformReleaseHistory").take(1))[0];
			await ctx.db.patch(history._id, { evidenceJson: `${history.evidenceJson} ` });
		});
		await expect(
			t.action(internal.platformReleaseRecordsNode.importObservation, { target, evidenceJson }),
		).rejects.toThrow("digest changed");
	});
});
