import type { ReleaseSummary } from "../../convex/helpers/platformReleaseRecords";
import { deriveReleaseStatus, type ReleaseRecord, type ReleaseTarget } from "./records.mjs";

function deployment(value: ReleaseRecord<"deployment"> | null) {
	return value
		? {
				recordId: value.recordId,
				deploymentId: value.data.deploymentId,
				sourceRevision: value.data.sourceRevision,
				url: value.data.url,
				status: value.data.status,
				observedAt: value.observedAt,
			}
		: null;
}

/** The displayed packages belong to the observed deployment, never a newer build. */
export function projectReleaseSummary(
	records: ReleaseRecord[],
	target: ReleaseTarget,
): ReleaseSummary {
	const status = deriveReleaseStatus(records, target);
	const current = status.currentDeployment;
	const build = records.find(
		(record) => record.kind === "build" && record.recordId === current?.data.buildRecordId,
	);
	const currentBuild = build?.kind === "build" ? build : null;
	const intended = status.intended;
	const versions =
		!intended || !currentBuild
			? "unknown"
			: intended.data.packages.every((expected) =>
						currentBuild.data.packages.some(
							(actual) => actual.name === expected.name && actual.version === expected.version,
						),
					)
				? "match"
				: "mismatch";
	const source =
		!intended?.data.sourceRevision || !current
			? "unknown"
			: intended.data.sourceRevision === current.data.sourceRevision
				? "match"
				: "mismatch";
	const contract =
		!intended?.identity.contractFingerprint || !current?.identity.contractFingerprint
			? "unknown"
			: intended.identity.contractFingerprint === current.identity.contractFingerprint
				? "match"
				: "mismatch";
	const currentHealth =
		status.history.find((entry) => entry.deploymentRecordId === current?.recordId)?.health ??
		"unknown";
	const failedLatest =
		status.latestDeployment && ["ERROR", "CANCELED"].includes(status.latestDeployment.data.status);
	const nextAction =
		failedLatest || currentHealth === "failed"
			? "investigate-release"
			: !current
				? "record-deployment"
				: status.verification.status !== "passed" || currentHealth !== "healthy"
					? "complete-verification"
					: !intended
						? "record-intent"
						: [versions, source, contract].includes("mismatch")
							? "align-release"
							: "verify-runtime";
	return {
		observedAt:
			records
				.map((record) => record.observedAt)
				.sort()
				.at(-1) ?? null,
		intended: intended
			? {
					recordId: intended.recordId,
					sourceRevision: intended.data.sourceRevision,
					packages: intended.data.packages.map(({ name, version }) => ({ name, version })),
					reviewRef: intended.data.reviewRef,
				}
			: null,
		currentDeployment: deployment(current),
		latestDeployment: deployment(status.latestDeployment),
		lastHealthy: deployment(status.lastHealthy),
		currentBuild: currentBuild
			? {
					recordId: currentBuild.recordId,
					packages: currentBuild.data.packages.map(({ name, version }) => ({ name, version })),
					scope: currentBuild.data.scope,
				}
			: null,
		currentHealth,
		verification: {
			status: status.verification.status,
			checks: status.verification.checks.map(({ id, scope, result, observedAt, evidenceRef }) => ({
				id,
				scope,
				result,
				observedAt,
				evidenceRef,
			})),
		},
		compatibility: { versions, source, contract, runtime: "unknown" },
		configurationObserved:
			current?.data.configFingerprint !== null && current?.data.configFingerprint !== undefined,
		capabilitiesObserved: status.capabilities !== null,
		nextAction,
	};
}
