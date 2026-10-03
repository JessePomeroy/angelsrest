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
import { statusTarget } from "./observe.mjs";
import { assertObservationLinks, assertObservationReceipt } from "./receipts.mjs";
import { assertReleaseRecord, deriveReleaseStatus } from "./records.mjs";

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

export function readReleaseHistory(root, target) {
	deriveReleaseStatus([], statusTarget(target));
	const path = directory(root, target.environmentId, false);
	if (path === null) return [];
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
	assertObservationLinks(records, receipts, target);
	deriveReleaseStatus(records, statusTarget(target));
	return records;
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
	const prior = readReleaseHistory(root, target);
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
