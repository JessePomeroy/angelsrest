import { isDeepStrictEqual } from "node:util";
import { deriveReleaseStatus } from "../../packages/crm-api/src/releases/records.mjs";

const adminPackage = "@jessepomeroy/admin";

function linkedBuild(records, deployment) {
	return records.find((record) => record.recordId === deployment?.data.buildRecordId) ?? null;
}

function packagesExceptAdmin(build) {
	return build?.data.packages
		.filter((entry) => entry.name !== adminPackage)
		.sort((left, right) => left.name.localeCompare(right.name));
}

function contracts(build) {
	if (!build) return null;
	return {
		backend: [...build.data.requiredContracts.backend].sort(),
		workers: [...build.data.requiredContracts.workers].sort((a, b) => a.id.localeCompare(b.id)),
	};
}

function reference(deployment, build) {
	return deployment && build
		? {
				deploymentId: deployment.data.deploymentId,
				deploymentRecordId: deployment.recordId,
				buildRecordId: build.recordId,
				sourceRevision: deployment.data.sourceRevision,
				observedAt: deployment.observedAt,
				packages: build.data.packages,
				lockfileDigest: build.data.lockfileDigest,
			}
		: null;
}

/** A retained-evidence gate for an Admin-only host update; it grants no runtime authority. */
export function assessAdminAdoption({ staging, production, candidateRevision, version }) {
	if (
		!/^[a-f0-9]{40,64}$/.test(candidateRevision) ||
		!/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z.-]+)?$/.test(version)
	) {
		throw new Error("Expected an exact candidate revision and package version.");
	}
	if (
		staging.target.environmentId !== "staging" ||
		production.target.environmentId !== "production" ||
		staging.target.publicOrigin === production.target.publicOrigin ||
		staging.target.repository !== production.target.repository ||
		staging.target.siteUrl !== production.target.siteUrl ||
		!isDeepStrictEqual(staging.target.requiredChecks, production.target.requiredChecks)
	) {
		throw new Error(
			"Adoption requires separate staging and production scopes with the same check policy.",
		);
	}
	const staged = deriveReleaseStatus(staging.records, staging.target);
	const live = deriveReleaseStatus(production.records, production.target);
	const stagedBuild = linkedBuild(staging.records, staged.currentDeployment);
	const liveBuild = linkedBuild(production.records, live.currentDeployment);
	const rollbackBuild = linkedBuild(production.records, live.lastHealthy);
	if (
		staged.currentDeployment?.data.target === "production" ||
		(live.currentDeployment && live.currentDeployment.data.target !== "production") ||
		(live.lastHealthy && live.lastHealthy.data.target !== "production")
	) {
		throw new Error("Provider deployment targets do not match the adoption scopes.");
	}
	const stagedEntry = staged.history.find(
		(entry) => entry.deploymentRecordId === staged.currentDeployment?.recordId,
	);
	const candidateMatches =
		stagedBuild?.data.sourceRevision === candidateRevision &&
		stagedBuild.data.packages.some(
			(entry) =>
				entry.name === adminPackage && entry.version === version && entry.source === "installed",
		);
	const runtimeRequirements =
		!stagedBuild || !liveBuild
			? "unknown"
			: isDeepStrictEqual(contracts(stagedBuild), contracts(liveBuild)) &&
					isDeepStrictEqual(packagesExceptAdmin(stagedBuild), packagesExceptAdmin(liveBuild))
				? "unchanged"
				: "changed";
	const stagingStatus = !staged.currentDeployment
		? "unknown"
		: !candidateMatches
			? "candidate-mismatch"
			: (stagedEntry?.health ?? "unknown");
	const rollback = reference(live.lastHealthy, rollbackBuild);
	const evidenceReady =
		stagingStatus === "healthy" &&
		runtimeRequirements === "unchanged" &&
		rollback !== null &&
		staged.unresolvedRecordIds.length === 0 &&
		live.unresolvedRecordIds.length === 0;
	return {
		version: 1,
		repository: staging.target.repository,
		siteUrl: staging.target.siteUrl,
		candidate: { sourceRevision: candidateRevision, package: adminPackage, version },
		evidenceReady,
		staging: {
			status: stagingStatus,
			release: reference(staged.currentDeployment, stagedBuild),
			verification: staged.verification,
		},
		production: {
			release: reference(live.currentDeployment, liveBuild),
			verification: live.verification,
		},
		runtimeRequirements,
		runtimeCompatibility: "unknown",
		rollback: {
			release: rollback,
			providerAvailability: "unverified",
			runtimeCompatibility: "unknown",
		},
		nextAction:
			stagingStatus !== "healthy"
				? "verify-candidate-staging"
				: runtimeRequirements !== "unchanged"
					? "review-backend-first-rollout"
					: !rollback
						? "record-production-recovery-reference"
						: !evidenceReady
							? "resolve-evidence-links"
							: "review-runtime-compatibility-and-host-merge",
	};
}
