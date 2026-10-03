import type { ReleaseRecord, ReleaseTarget, VerificationResult } from "./records.mjs";

export type ObservationReceipt = {
	version: 1;
	observedAt: string;
	buildRecordId: string;
	deploymentRecordId: string;
	artifact: { id: string; digest: string; bytes: number; runId: string; runAttempt: number; url: string };
	provider: { accountId: string; projectId: string; deploymentId: string; aliasStableDuringChecks: boolean };
	publicChecks: { path: string; status: number | null; html: boolean | null; result: VerificationResult }[];
};

export function assertObservationReceipt(receipt: unknown, filename: string): asserts receipt is ObservationReceipt;
export function assertObservationLinks(
	records: readonly ReleaseRecord[],
	receipts: ReadonlyMap<string, ObservationReceipt>,
	target: Pick<ReleaseTarget, "environmentId" | "publicOrigin">,
): void;
