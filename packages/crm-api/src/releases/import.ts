import { createHash } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import {
	MAX_RELEASE_HISTORY_BYTES,
	MAX_RELEASE_IMPORT_BYTES,
} from "../../convex/helpers/platformReleaseRecords";
import {
	assertObservationLinks,
	assertObservationReceipt,
	type ObservationReceipt,
} from "./receipts.mjs";
import {
	assertReleaseRecord,
	deriveReleaseStatus,
	type ReleaseRecord,
	type ReleaseTarget,
} from "./records.mjs";
import { projectReleaseSummary } from "./project";

type Evidence = {
	records: ReleaseRecord[];
	receipts: { name: string; value: ObservationReceipt }[];
};

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function parseEvidence(json: string, maximum: number): Evidence {
	if (Buffer.byteLength(json) > maximum)
		throw new Error("Release evidence exceeds its reviewed size limit.");
	const value: unknown = JSON.parse(json);
	if (
		!object(value) ||
		Object.keys(value).sort().join(",") !== "receipts,records" ||
		!Array.isArray(value.records) ||
		!Array.isArray(value.receipts) ||
		value.records.length > 500 ||
		value.receipts.length > 500
	) {
		throw new Error("Invalid release evidence envelope.");
	}
	const records = value.records.map(assertReleaseRecord);
	const receipts = value.receipts.map((entry: unknown) => {
		if (
			!object(entry) ||
			Object.keys(entry).sort().join(",") !== "name,value" ||
			typeof entry.name !== "string"
		)
			throw new Error("Invalid observation receipt entry.");
		assertObservationReceipt(entry.value, entry.name);
		return { name: entry.name, value: entry.value };
	});
	return { records, receipts };
}

function append<T>(prior: T[], incoming: T[], key: (value: T) => string): T[] {
	const entries = new Map<string, T>();
	for (const value of [...prior, ...incoming]) {
		const id = key(value);
		const previous = entries.get(id);
		if (previous) {
			if (!isDeepStrictEqual(previous, value))
				throw new Error("Immutable release evidence conflict.");
			// A canonical record ID ignores object-key order; preserve the first validated bytes.
			continue;
		}
		entries.set(id, value);
	}
	return [...entries.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, value]) => value);
}

export function normalizeReleaseTarget(target: ReleaseTarget): ReleaseTarget {
	deriveReleaseStatus([], target);
	return {
		...target,
		requiredChecks: [...target.requiredChecks].sort((a, b) =>
			`${a.scope}:${a.id}`.localeCompare(`${b.scope}:${b.id}`),
		),
	};
}

/** Revalidate saved and incoming proof together before the transaction may append anything. */
export function prepareReleaseImport(
	priorJson: string | null,
	incomingJson: string,
	target: ReleaseTarget,
) {
	const prior =
		priorJson === null
			? { records: [], receipts: [] }
			: parseEvidence(priorJson, MAX_RELEASE_HISTORY_BYTES);
	const incoming = parseEvidence(incomingJson, MAX_RELEASE_IMPORT_BYTES);
	if (incoming.records.length === 0) throw new Error("Release import has no records.");
	const records = append(prior.records, incoming.records, (entry) => entry.recordId);
	const receipts = append(prior.receipts, incoming.receipts, (entry) => entry.name);
	if (receipts.length > 500)
		throw new Error("Release history requires an explicit retention review.");
	assertObservationLinks(
		records,
		new Map(receipts.map(({ name, value }) => [name, value])),
		target,
	);
	const status = deriveReleaseStatus(records, target);
	if (status.unresolvedRecordIds.length) throw new Error("Release evidence has unresolved links.");
	const evidenceJson = JSON.stringify({ records, receipts });
	if (Buffer.byteLength(evidenceJson) > MAX_RELEASE_HISTORY_BYTES)
		throw new Error("Release history requires an explicit retention review.");
	return {
		evidenceJson,
		digest: createHash("sha256").update(evidenceJson).digest("hex"),
		summary: projectReleaseSummary(records, target),
	};
}
