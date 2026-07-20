import { describe, expect, test } from "vitest";
import { inspectCatalogPrivateZip } from "./catalogPrivateZipInspection";

const encoder = new TextEncoder();

type ZipEntryFixture = {
	name: string;
	compressedSize?: number;
	uncompressedSize?: number;
	flags?: number;
	centralExtra?: Uint8Array;
};

function uint16(value: number) {
	return [value & 0xff, (value >>> 8) & 0xff];
}

function uint32(value: number) {
	return [value & 0xff, (value >>> 8) & 0xff, (value >>> 16) & 0xff, (value >>> 24) & 0xff];
}

function zipFixture(entries: ZipEntryFixture[], comment = new Uint8Array()) {
	const localParts: number[] = [];
	const centralParts: number[] = [];
	let localOffset = 0;
	for (const entry of entries) {
		const name = encoder.encode(entry.name);
		const compressedSize = entry.compressedSize ?? 1;
		const uncompressedSize = entry.uncompressedSize ?? compressedSize;
		const flags = entry.flags ?? 0;
		const extra = entry.centralExtra ?? new Uint8Array();
		localParts.push(
			...uint32(0x04034b50),
			...uint16(20),
			...uint16(flags),
			...uint16(8),
			...uint16(0),
			...uint16(0),
			...uint32(0),
			...uint32(compressedSize),
			...uint32(uncompressedSize),
			...uint16(name.byteLength),
			...uint16(0),
			...name,
			...new Uint8Array(compressedSize),
		);
		centralParts.push(
			...uint32(0x02014b50),
			...uint16(20),
			...uint16(20),
			...uint16(flags),
			...uint16(8),
			...uint16(0),
			...uint16(0),
			...uint32(0),
			...uint32(compressedSize),
			...uint32(uncompressedSize),
			...uint16(name.byteLength),
			...uint16(extra.byteLength),
			...uint16(0),
			...uint16(0),
			...uint16(0),
			...uint32(0),
			...uint32(localOffset),
			...name,
			...extra,
		);
		localOffset = localParts.length;
	}
	const centralOffset = localParts.length;
	return new Uint8Array([
		...localParts,
		...centralParts,
		...uint32(0x06054b50),
		...uint16(0),
		...uint16(0),
		...uint16(entries.length),
		...uint16(entries.length),
		...uint32(centralParts.length),
		...uint32(centralOffset),
		...uint16(comment.byteLength),
		...comment,
	]);
}

function eocdOffset(bytes: Uint8Array) {
	return bytes.byteLength - 22;
}

describe("inspectCatalogPrivateZip", () => {
	test("returns the Convex safe ZIP inspection metrics without inflating entries", () => {
		const zip = zipFixture([
			{ name: "safe/readme.txt", compressedSize: 8, uncompressedSize: 4 },
			{ name: "images/./photo.jpg", compressedSize: 10, uncompressedSize: 100 },
			{ name: "images/photo.jpg", compressedSize: 5, uncompressedSize: 5 },
			{ name: "../escape.txt", compressedSize: 2, uncompressedSize: 2 },
			{ name: "unsafe\\backslash.txt", compressedSize: 2, uncompressedSize: 2 },
			{ name: "C:/private.txt", compressedSize: 3, uncompressedSize: 3 },
			{ name: "/absolute.txt", compressedSize: 1, uncompressedSize: 1 },
			{ name: "locked.bin", compressedSize: 4, uncompressedSize: 12, flags: 0x0001 },
		]);

		expect(inspectCatalogPrivateZip(zip)).toEqual({
			entryCount: 8,
			totalUncompressedBytes: 129,
			maximumEntryCompressionRatio: 10,
			encryptedEntryCount: 1,
			unsafePathCount: 4,
			duplicatePathCount: 1,
		});
	});

	test("normalizes separators, empty components, and dot components when finding duplicates", () => {
		const zip = zipFixture([
			{ name: "folder/item.txt" },
			{ name: "folder//item.txt" },
			{ name: "folder/./item.txt" },
			{ name: "folder\\item.txt" },
		]);

		expect(inspectCatalogPrivateZip(zip)).toMatchObject({
			unsafePathCount: 1,
			duplicatePathCount: 3,
		});
	});

	test("keeps the maximum compression ratio at least one and accepts an empty archive", () => {
		expect(inspectCatalogPrivateZip(zipFixture([]))).toEqual({
			entryCount: 0,
			totalUncompressedBytes: 0,
			maximumEntryCompressionRatio: 1,
			encryptedEntryCount: 0,
			unsafePathCount: 0,
			duplicatePathCount: 0,
		});
		expect(
			inspectCatalogPrivateZip(
				zipFixture([{ name: "metadata.bin", compressedSize: 10, uncompressedSize: 2 }]),
			).maximumEntryCompressionRatio,
		).toBe(1);
	});

	test("finds the real end record when its comment contains a signature", () => {
		const zip = zipFixture(
			[{ name: "safe.txt" }],
			new Uint8Array([...uint32(0x06054b50), 1, 2, 3, 4]),
		);
		expect(inspectCatalogPrivateZip(zip).entryCount).toBe(1);
	});

	test.each([
		["truncated archive", (zip: Uint8Array) => zip.subarray(0, -1), /end-of-central-directory/],
		[
			"malformed central header",
			(zip: Uint8Array) => {
				const copy = zip.slice();
				new DataView(copy.buffer).setUint32(39, 0, true);
				return copy;
			},
			/central file header signature/,
		],
		[
			"multi-disk archive",
			(zip: Uint8Array) => {
				const copy = zip.slice();
				new DataView(copy.buffer).setUint16(eocdOffset(copy) + 4, 1, true);
				return copy;
			},
			/multi-disk/,
		],
		[
			"ZIP64 end record",
			(zip: Uint8Array) => {
				const copy = zip.slice();
				new DataView(copy.buffer).setUint16(eocdOffset(copy) + 10, 0xffff, true);
				return copy;
			},
			/ZIP64/,
		],
	] as const)("rejects a %s", (_label, mutate, expected) => {
		const zip = zipFixture([{ name: "safe.txt", compressedSize: 1 }]);
		expect(() => inspectCatalogPrivateZip(mutate(zip))).toThrow(expected);
	});

	test("rejects ZIP64 entry extra fields", () => {
		const zip64Extra = new Uint8Array([...uint16(0x0001), ...uint16(0)]);
		expect(() =>
			inspectCatalogPrivateZip(zipFixture([{ name: "safe.txt", centralExtra: zip64Extra }])),
		).toThrow(/ZIP64/);
	});

	test("rejects local entries whose metadata or payload bounds are invalid", () => {
		const badSignature = zipFixture([{ name: "safe.txt" }]);
		new DataView(badSignature.buffer).setUint32(0, 0, true);
		expect(() => inspectCatalogPrivateZip(badSignature)).toThrow(/local file header signature/);

		const badSize = zipFixture([{ name: "safe.txt" }]);
		new DataView(badSize.buffer).setUint32(18, 0xfffffff0, true);
		expect(() => inspectCatalogPrivateZip(badSize)).toThrow(
			/local and central file sizes disagree/,
		);
	});
});
