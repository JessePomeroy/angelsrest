export type ReleaseIdentity = {
	repository: string;
	siteUrl: string;
	environmentId: string;
	contractFingerprint: string | null;
};
export type ReleasePackage = {
	name: string;
	version: string;
	source: "installed" | "workspace";
};
export type ReleaseContracts = {
	backend: string[];
	workers: { id: string; repository: string | null; sourceRevision: string | null }[];
};
export type CapabilityName =
	| "portfolio"
	| "sitePages"
	| "blog"
	| "catalog"
	| "privateCatalogAssets"
	| "crm"
	| "delivery"
	| "commerce";
export type VerificationScope = "public" | "anonymous-auth" | "client-ui" | "operator-api" | "provider";
export type CheckIdentity = { id: string; scope: VerificationScope };
export type VerificationResult = "passed" | "failed" | "blocked";
export type PublicReleaseConfig = {
	publicOrigin: string | null;
	convexUrl: string | null;
	convexSiteUrl: string | null;
	cmsMediaOrigin: string | null;
	checkoutSnapshotMode: "handle-v2" | "inline-v1" | null;
	mutationTransport: "http";
};
export type BuildCheck =
	| "dependency_install"
	| "worker_checkout"
	| "worker_install"
	| "lint"
	| "typecheck"
	| "tests"
	| "retired_checkout"
	| "build"
	| "component_browser"
	| "e2e";
export type DeploymentState = "READY" | "ERROR" | "CANCELED" | "BUILDING" | "QUEUED" | "INITIALIZING" | "UNKNOWN";
export type ReleaseData = {
	intended: {
		sourceRevision: string | null;
		packages: ReleasePackage[];
		capabilities: Record<CapabilityName, "included" | "excluded">;
		requiredContracts: ReleaseContracts;
		reviewRef: string;
	};
	build: {
		sourceRevision: string;
		sourceFingerprint: string | null;
		packages: ReleasePackage[];
		lockfileDigest: string;
		scope: "ci-fixture" | "configured-release";
		publicConfig: PublicReleaseConfig;
		configFingerprint: string;
		requiredContracts: ReleaseContracts;
		github: { runId: string; runAttempt: number; event: string; ref: string; headSha: string; workflow: string };
		checks: Record<BuildCheck, "success" | "failure" | "cancelled" | "skipped">;
		output: { scope: "static-client-assets"; digest: string | null; fileCount: number; bytes: number };
	};
	deployment: {
		buildRecordId: string;
		provider: "vercel";
		accountId: string;
		projectId: string;
		deploymentId: string;
		url: string;
		target: string;
		status: DeploymentState;
		sourceRevision: string;
		configFingerprint: string | null;
		binding: "source-only";
		aliases: { hostname: string; assigned: boolean | null }[];
	};
	capabilities: {
		deploymentRecordId: string;
		values: Record<CapabilityName, "enabled" | "disabled" | "unknown">;
		evidenceRefs: string[];
	};
	verification: {
		deploymentRecordId: string;
		configFingerprint: string | null;
		checks: (CheckIdentity & { result: VerificationResult; evidenceRef: string })[];
	};
};
export type ReleaseKind = keyof ReleaseData;
export type ReleaseInput<K extends ReleaseKind = ReleaseKind> = {
	[P in K]: { kind: P; identity: ReleaseIdentity; observedAt: string; data: ReleaseData[P] };
}[K];
export type ReleaseRecord<K extends ReleaseKind = ReleaseKind> = ReleaseInput<K> & {
	version: 1;
	recordId: string;
};
export type ReleaseTarget = Omit<ReleaseIdentity, "contractFingerprint"> & {
	publicOrigin: string;
	requiredChecks: CheckIdentity[];
};
export type ObservedCheck = CheckIdentity & {
	result: VerificationResult | "unknown";
	observedAt: string | null;
	recordId: string | null;
	evidenceRef: string | null;
};
export type ReleaseVerification = {
	deploymentRecordId: string | null;
	status: VerificationResult | "unknown";
	checks: ObservedCheck[];
};
export type ReleaseStatus = {
	identity: Omit<ReleaseIdentity, "contractFingerprint">;
	intended: ReleaseRecord<"intended"> | null;
	build: ReleaseRecord<"build"> | null;
	latestDeployment: ReleaseRecord<"deployment"> | null;
	currentDeployment: ReleaseRecord<"deployment"> | null;
	capabilities: ReleaseRecord<"capabilities"> | null;
	verification: ReleaseVerification;
	lastHealthy: ReleaseRecord<"deployment"> | null;
	unresolvedRecordIds: string[];
	history: {
		deploymentRecordId: string;
		buildRecordId: string;
		observedAt: string;
		health: "healthy" | "failed" | "blocked" | "unknown";
		configFingerprint: string | null;
		binding: "source-only";
		verification: ReleaseVerification;
		capabilities: ReleaseRecord<"capabilities"> | null;
	}[];
};

export function fingerprintPublicConfig(value: unknown): string;
export function createReleaseRecord<K extends ReleaseKind>(input: ReleaseInput<K>): ReleaseRecord<K>;
export function assertReleaseRecord(value: unknown): ReleaseRecord;
export function deriveReleaseStatus(input: readonly ReleaseRecord[], target: ReleaseTarget): ReleaseStatus;
