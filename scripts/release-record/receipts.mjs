import { createHash } from "node:crypto";

function requireEvidence(condition) {
	if (!condition) throw new Error("Retained release evidence is incomplete or inconsistent.");
}
function keys(value, expected) {
	return (
		value &&
		typeof value === "object" &&
		!Array.isArray(value) &&
		Object.keys(value).length === expected.length &&
		expected.every((key) => Object.hasOwn(value, key))
	);
}

export function assertObservationReceipt(receipt, filename) {
	requireEvidence(
		keys(receipt, [
			"version",
			"observedAt",
			"buildRecordId",
			"deploymentRecordId",
			"artifact",
			"provider",
			"publicChecks",
		]),
	);
	const artifact = receipt.artifact;
	const provider = receipt.provider;
	requireEvidence(
		receipt.version === 1 &&
			typeof receipt.observedAt === "string" &&
			new Date(receipt.observedAt).toISOString() === receipt.observedAt &&
			Date.parse(receipt.observedAt) <= Date.now() + 5 * 60_000 &&
			/^sha256:[a-f0-9]{64}$/.test(receipt.buildRecordId) &&
			/^sha256:[a-f0-9]{64}$/.test(receipt.deploymentRecordId) &&
			keys(artifact, ["id", "digest", "bytes", "runId", "runAttempt", "url"]) &&
			/^[1-9]\d{0,19}$/.test(artifact.id) &&
			/^sha256:[a-f0-9]{64}$/.test(artifact.digest) &&
			/^[1-9]\d{0,29}$/.test(artifact.runId) &&
			Number.isSafeInteger(artifact.runAttempt) &&
			artifact.runAttempt > 0 &&
			/^https:\/\/github\.com\/[A-Za-z0-9-]+\/[A-Za-z0-9._-]+\/actions\/runs\/[1-9]\d*\/artifacts\/[1-9]\d*$/.test(
				artifact.url,
			) &&
			Number.isSafeInteger(artifact.bytes) &&
			artifact.bytes > 0 &&
			artifact.bytes <= 1024 * 1024 &&
			keys(provider, ["accountId", "projectId", "deploymentId", "aliasStableDuringChecks"]) &&
			/^team_[A-Za-z0-9]+$/.test(provider.accountId) &&
			/^prj_[A-Za-z0-9]+$/.test(provider.projectId) &&
			/^dpl_[A-Za-z0-9]+$/.test(provider.deploymentId) &&
			typeof provider.aliasStableDuringChecks === "boolean" &&
			Array.isArray(receipt.publicChecks) &&
			receipt.publicChecks.length <= 10 &&
			new Set(receipt.publicChecks.map((check) => check.path)).size ===
				receipt.publicChecks.length &&
			receipt.publicChecks.every(
				(check) =>
					keys(check, ["path", "status", "html", "result"]) &&
					typeof check.path === "string" &&
					/^\/(?:[a-z0-9-]+\/?)*$/.test(check.path) &&
					check.path.length <= 100 &&
					(check.status === null
						? check.html === null
						: Number.isInteger(check.status) &&
							check.status >= 100 &&
							check.status <= 599 &&
							typeof check.html === "boolean") &&
					["passed", "failed", "blocked"].includes(check.result) &&
					(check.result !== "passed" ||
						(provider.aliasStableDuringChecks && check.status === 200 && check.html === true)),
			),
	);
	const hash = createHash("sha256").update(JSON.stringify(receipt)).digest("hex");
	requireEvidence(filename === `observation-${hash}.json`);
}

/** Orphan receipts are valid after an interruption; records still need their proof. */
export function assertObservationLinks(records, receipts, target) {
	for (const record of records) {
		if (record.kind === "build") {
			const { github } = record.data;
			requireEvidence(
				[...receipts.values()].some(
					(receipt) =>
						receipt.buildRecordId === record.recordId &&
						receipt.observedAt >= record.observedAt &&
						receipt.artifact.runId === github.runId &&
						receipt.artifact.runAttempt === github.runAttempt &&
						receipt.artifact.url ===
							`https://github.com/${record.identity.repository}/actions/runs/${github.runId}/artifacts/${receipt.artifact.id}`,
				),
			);
		} else if (record.kind === "deployment") {
			requireEvidence(
				[...receipts.values()].some(
					(receipt) =>
						receipt.deploymentRecordId === record.recordId &&
						receipt.buildRecordId === record.data.buildRecordId &&
						receipt.observedAt === record.observedAt &&
						["accountId", "projectId", "deploymentId"].every(
							(key) => receipt.provider[key] === record.data[key],
						) &&
						(!receipt.provider.aliasStableDuringChecks ||
							record.data.aliases.some(
								(alias) =>
									alias.hostname === new URL(target.publicOrigin).hostname &&
									alias.assigned === true,
							)),
				),
			);
		} else if (record.kind === "verification") {
			const prefix = `docs/integration-evidence/releases/${target.environmentId}/`;
			const reference = record.data.checks[0].evidenceRef;
			requireEvidence(reference.startsWith(prefix));
			const receipt = receipts.get(reference.slice(prefix.length));
			requireEvidence(
				receipt &&
					receipt.deploymentRecordId === record.data.deploymentRecordId &&
					receipt.observedAt === record.observedAt &&
					receipt.publicChecks.length === record.data.checks.length &&
					record.data.checks.every(
						(check) =>
							check.evidenceRef === reference &&
							check.scope === "public" &&
							receipt.publicChecks.some(
								(probe) => check.id === `http:${probe.path}` && check.result === probe.result,
							),
					),
			);
		}
	}
}
