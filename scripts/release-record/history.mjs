import { randomBytes } from "node:crypto";
import {
	closeSync,
	fsyncSync,
	linkSync,
	lstatSync,
	mkdirSync,
	openSync,
	readdirSync,
	readFileSync,
	realpathSync,
	unlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import {
	assertObservationLinks,
	assertObservationReceipt,
} from "../../packages/crm-api/src/releases/receipts.mjs";
import {
	assertReleaseRecord,
	deriveReleaseStatus,
} from "../../packages/crm-api/src/releases/records.mjs";
import { statusTarget } from "./observe.mjs";

function directory(root, environmentId, create) {
	let current = realpathSync(root);
	for (const segment of ["docs", "integration-evidence", "releases", environmentId]) {
		current = join(current, segment);
		try {
			if (!lstatSync(current).isDirectory()) throw new Error("Nonlocal release history path.");
		} catch (error) {
			if (error.code !== "ENOENT") throw error;
			if (!create) return null;
			mkdirSync(current);
		}
	}
	return current;
}

function existingBytes(path) {
	try {
		const info = lstatSync(path);
		if (!info.isFile() || info.size > 256 * 1024) throw new Error("Invalid release history file.");
		return readFileSync(path, "utf8");
	} catch (error) {
		if (error.code === "ENOENT") return null;
		throw error;
	}
}

function readStoredEvidence(root, target) {
	deriveReleaseStatus([], statusTarget(target));
	const path = directory(root, target.environmentId, false);
	if (path === null) return { records: [], receipts: new Map() };
	const files = readdirSync(path);
	if (files.length > 1000) throw new Error("Release history needs an explicit retention review.");
	const records = [];
	const receipts = new Map();
	for (const filename of files) {
		// Only our unpublished temporary files may survive an interrupted write.
		if (/^\.pending-[a-f0-9]{32}\.json$/.test(filename)) continue;
		if (/^observation-[a-f0-9]{64}\.json$/.test(filename)) {
			const receipt = JSON.parse(existingBytes(join(path, filename)));
			assertObservationReceipt(receipt, filename);
			receipts.set(filename, receipt);
			continue;
		}
		if (!/^[a-f0-9]{64}\.json$/.test(filename)) throw new Error("Unexpected release history file.");
		const value = assertReleaseRecord(JSON.parse(existingBytes(join(path, filename))));
		if (filename !== `${value.recordId.slice(7)}.json`) throw new Error("Changed release history.");
		records.push(value);
	}
	// Validate every chain before selecting an origin. An unrelated corrupt record
	// must not disappear from validation just because this request uses another alias.
	deriveReleaseStatus(records, statusTarget(target));
	for (const record of records) {
		let observedTarget = target;
		if (record.kind === "deployment") {
			// The observer records exactly the one alias it independently checked.
			// More aliases would make the receipt's public-check origin ambiguous.
			if (record.data.aliases.length !== 1)
				throw new Error("Ambiguous release observation origin.");
			observedTarget = { ...target, publicOrigin: `https://${record.data.aliases[0].hostname}` };
		}
		assertObservationLinks([record], receipts, observedTarget);
	}
	return { records, receipts };
}

function evidenceForOrigin({ records, receipts }, target) {
	const hostname = new URL(target.publicOrigin).hostname;
	const deployments = records.filter(
		(record) => record.kind === "deployment" && record.data.aliases[0].hostname === hostname,
	);
	const deploymentIds = new Set(deployments.map((record) => record.recordId));
	const buildIds = new Set(deployments.map((record) => record.data.buildRecordId));
	return {
		records: records.filter((record) => {
			if (record.kind === "intended") return true;
			if (record.kind === "build") return buildIds.has(record.recordId);
			if (record.kind === "deployment") return deploymentIds.has(record.recordId);
			return deploymentIds.has(record.data.deploymentRecordId);
		}),
		receipts: [...receipts]
			.filter(([, receipt]) => deploymentIds.has(receipt.deploymentRecordId))
			.map(([name, value]) => ({ name, value })),
	};
}

export function readReleaseEvidence(root, target) {
	return evidenceForOrigin(readStoredEvidence(root, target), target);
}

export function readReleaseHistory(root, target) {
	return readReleaseEvidence(root, target).records;
}

function publishBytes(directory, filename, bytes) {
	const temporary = join(directory, `.pending-${randomBytes(16).toString("hex")}.json`);
	let descriptor;
	try {
		descriptor = openSync(temporary, "wx", 0o600);
		writeFileSync(descriptor, bytes);
		fsyncSync(descriptor);
		closeSync(descriptor);
		descriptor = undefined;
		// A hard link publishes complete bytes atomically and refuses existing names.
		try {
			linkSync(temporary, filename);
		} catch (error) {
			if (error.code !== "EEXIST" || existingBytes(filename) !== bytes) throw error;
		}
		const parent = openSync(directory, "r");
		try {
			fsyncSync(parent);
		} finally {
			closeSync(parent);
		}
	} finally {
		if (descriptor !== undefined) closeSync(descriptor);
		try {
			unlinkSync(temporary);
		} catch {
			// An unpublished scratch file is ignored; cleanup must not mask an I/O failure.
		}
	}
}

/** Validate the whole batch before exclusive writes; interruption never removes old proof. */
export function retainReleaseObservation(root, target, observation) {
	const stored = readStoredEvidence(root, target);
	// Retention and cross-record invariants still cover the complete environment.
	deriveReleaseStatus([...stored.records, ...observation.records], statusTarget(target));
	const prior = evidenceForOrigin(stored, target).records;
	const status = deriveReleaseStatus([...prior, ...observation.records], statusTarget(target));
	if (!/^observation-[a-f0-9]{64}\.json$/.test(observation.receiptName))
		throw new Error("Invalid observation receipt name.");
	assertObservationReceipt(observation.receipt, observation.receiptName);
	assertObservationLinks(
		observation.records,
		new Map([[observation.receiptName, observation.receipt]]),
		target,
	);
	const entries = [
		[observation.receiptName, observation.receipt],
		...observation.records.map((record) => [`${record.recordId.slice(7)}.json`, record]),
	].map(([name, value]) => [name, `${JSON.stringify(value, null, 2)}\n`]);
	const path = directory(root, target.environmentId, true);
	const pending = [];
	for (const [name, bytes] of entries) {
		const filename = join(path, name);
		const existing = existingBytes(filename);
		if (existing !== null && existing !== bytes)
			throw new Error("Immutable release history conflict.");
		if (existing === null) pending.push([filename, bytes]);
	}
	for (const [filename, bytes] of pending) publishBytes(path, filename, bytes);
	return status;
}
