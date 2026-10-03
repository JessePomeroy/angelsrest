import { type Infer, v } from "convex/values";

export const MAX_RELEASE_ENVIRONMENTS = 16;
export const MAX_RELEASE_HISTORY_BYTES = 512 * 1024;
export const MAX_RELEASE_IMPORT_BYTES = 96 * 1024;

const nullableString = v.union(v.string(), v.null());
const scope = v.union(
	v.literal("public"),
	v.literal("anonymous-auth"),
	v.literal("client-ui"),
	v.literal("operator-api"),
	v.literal("provider"),
);
const result = v.union(
	v.literal("passed"),
	v.literal("failed"),
	v.literal("blocked"),
	v.literal("unknown"),
);
const match = v.union(v.literal("match"), v.literal("mismatch"), v.literal("unknown"));
const packages = v.array(v.object({ name: v.string(), version: v.string() }));

export const releaseTargetValidator = v.object({
	repository: v.string(),
	siteUrl: v.string(),
	environmentId: v.string(),
	publicOrigin: v.string(),
	requiredChecks: v.array(v.object({ id: v.string(), scope })),
});
export type StoredReleaseTarget = Infer<typeof releaseTargetValidator>;

export function sameReleaseTarget(left: StoredReleaseTarget, right: StoredReleaseTarget) {
	const checks = (target: StoredReleaseTarget) =>
		target.requiredChecks
			.map(({ scope, id }) => `${scope}:${id}`)
			.sort()
			.join("\n");
	return (
		left.repository === right.repository &&
		left.siteUrl === right.siteUrl &&
		left.environmentId === right.environmentId &&
		left.publicOrigin === right.publicOrigin &&
		checks(left) === checks(right)
	);
}

const deployment = v.object({
	recordId: v.string(),
	deploymentId: v.string(),
	sourceRevision: v.string(),
	url: v.string(),
	status: v.union(
		v.literal("READY"),
		v.literal("ERROR"),
		v.literal("CANCELED"),
		v.literal("BUILDING"),
		v.literal("QUEUED"),
		v.literal("INITIALIZING"),
		v.literal("UNKNOWN"),
	),
	observedAt: v.string(),
});

export const releaseSummaryValidator = v.object({
	observedAt: nullableString,
	intended: v.union(
		v.object({
			recordId: v.string(),
			sourceRevision: nullableString,
			packages,
			reviewRef: v.string(),
		}),
		v.null(),
	),
	currentDeployment: v.union(deployment, v.null()),
	latestDeployment: v.union(deployment, v.null()),
	lastHealthy: v.union(deployment, v.null()),
	currentBuild: v.union(
		v.object({
			recordId: v.string(),
			packages,
			scope: v.union(v.literal("ci-fixture"), v.literal("configured-release")),
		}),
		v.null(),
	),
	currentHealth: v.union(
		v.literal("healthy"),
		v.literal("failed"),
		v.literal("blocked"),
		v.literal("unknown"),
	),
	verification: v.object({
		status: result,
		checks: v.array(
			v.object({
				id: v.string(),
				scope,
				result,
				observedAt: nullableString,
				evidenceRef: nullableString,
			}),
		),
	}),
	compatibility: v.object({
		versions: match,
		source: match,
		contract: match,
		runtime: v.literal("unknown"),
	}),
	configurationObserved: v.boolean(),
	capabilitiesObserved: v.boolean(),
	nextAction: v.union(
		v.literal("record-deployment"),
		v.literal("investigate-release"),
		v.literal("complete-verification"),
		v.literal("record-intent"),
		v.literal("align-release"),
		v.literal("verify-runtime"),
	),
});
export type ReleaseSummary = Infer<typeof releaseSummaryValidator>;

export const releaseEnvironmentFields = {
	clientId: v.id("platformClients"),
	target: releaseTargetValidator,
	version: v.number(),
	summary: releaseSummaryValidator,
};
export const releaseImportResultValidator = v.object({ changed: v.boolean(), version: v.number() });
