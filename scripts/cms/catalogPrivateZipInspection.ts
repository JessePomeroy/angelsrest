const CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const LOCAL_FILE_HEADER_SIGNATURE = 0x04034b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE = 0x07064b50;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
const MAX_UINT16 = 0xffff;
const MAX_UINT32 = 0xffffffff;
const EOCD_FIXED_SIZE = 22;
const CENTRAL_DIRECTORY_FILE_HEADER_FIXED_SIZE = 46;
const LOCAL_FILE_HEADER_FIXED_SIZE = 30;

export type CatalogPrivateZipInspection = {
	entryCount: number;
	totalUncompressedBytes: number;
	maximumEntryCompressionRatio: number;
	encryptedEntryCount: number;
	unsafePathCount: number;
	duplicatePathCount: number;
};

type CentralDirectoryEntry = {
	flags: number;
	compressionMethod: number;
	crc32: number;
	compressedSize: number;
	uncompressedSize: number;
	name: Uint8Array;
	localHeaderOffset: number;
};

function invalidZip(reason: string): never {
	throw new Error(`Invalid ZIP archive: ${reason}`);
}

function viewOf(bytes: Uint8Array) {
	return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

function requireRange(bytes: Uint8Array, offset: number, length: number, label: string) {
	if (
		!Number.isSafeInteger(offset) ||
		!Number.isSafeInteger(length) ||
		offset < 0 ||
		length < 0 ||
		offset > bytes.byteLength - length
	) {
		invalidZip(`${label} is truncated`);
	}
}

function findEndOfCentralDirectory(bytes: Uint8Array, view: DataView) {
	if (bytes.byteLength < EOCD_FIXED_SIZE) invalidZip("end-of-central-directory record is missing");
	const firstCandidate = Math.max(0, bytes.byteLength - EOCD_FIXED_SIZE - MAX_UINT16);
	for (let offset = bytes.byteLength - EOCD_FIXED_SIZE; offset >= firstCandidate; offset -= 1) {
		if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY_SIGNATURE) continue;
		const commentLength = view.getUint16(offset + 20, true);
		if (offset + EOCD_FIXED_SIZE + commentLength === bytes.byteLength) return offset;
	}
	return invalidZip("end-of-central-directory record is missing or malformed");
}

function containsZip64ExtraField(extra: Uint8Array) {
	const view = viewOf(extra);
	let offset = 0;
	while (offset < extra.byteLength) {
		if (offset > extra.byteLength - 4) invalidZip("extra field is truncated");
		const fieldId = view.getUint16(offset, true);
		const fieldLength = view.getUint16(offset + 2, true);
		offset += 4;
		if (offset > extra.byteLength - fieldLength) invalidZip("extra field payload is truncated");
		if (fieldId === ZIP64_EXTRA_FIELD_ID) return true;
		offset += fieldLength;
	}
	return false;
}

function sameBytes(left: Uint8Array, right: Uint8Array) {
	if (left.byteLength !== right.byteLength) return false;
	for (let index = 0; index < left.byteLength; index += 1) {
		if (left[index] !== right[index]) return false;
	}
	return true;
}

function isAsciiLetter(value: number | undefined) {
	return (
		value !== undefined && ((value >= 0x41 && value <= 0x5a) || (value >= 0x61 && value <= 0x7a))
	);
}

function pathFacts(name: Uint8Array) {
	const segments: number[][] = [];
	let current: number[] = [];
	let hasBackslash = false;
	let hasDotDotSegment = false;
	let hasNull = false;

	const finishSegment = () => {
		if (current.length === 2 && current[0] === 0x2e && current[1] === 0x2e) {
			hasDotDotSegment = true;
		}
		if (!(current.length === 0 || (current.length === 1 && current[0] === 0x2e))) {
			segments.push(current);
		}
		current = [];
	};

	for (const byte of name) {
		if (byte === 0) hasNull = true;
		if (byte === 0x2f || byte === 0x5c) {
			if (byte === 0x5c) hasBackslash = true;
			finishSegment();
		} else {
			current.push(byte);
		}
	}
	finishSegment();

	const isAbsolute = name[0] === 0x2f || name[0] === 0x5c;
	const hasDrivePrefix = isAsciiLetter(name[0]) && name[1] === 0x3a;
	const normalizedPath = segments
		.map((segment) => segment.map((byte) => byte.toString(16).padStart(2, "0")).join(""))
		.join("/");
	return {
		normalizedPath,
		unsafe: isAbsolute || hasBackslash || hasDrivePrefix || hasDotDotSegment || hasNull,
	};
}

function validateLocalEntry(
	bytes: Uint8Array,
	entry: CentralDirectoryEntry,
	centralOffset: number,
) {
	requireRange(bytes, entry.localHeaderOffset, LOCAL_FILE_HEADER_FIXED_SIZE, "local file header");
	const view = viewOf(bytes);
	const offset = entry.localHeaderOffset;
	if (view.getUint32(offset, true) !== LOCAL_FILE_HEADER_SIGNATURE) {
		invalidZip("local file header signature is malformed");
	}
	const flags = view.getUint16(offset + 6, true);
	const compressionMethod = view.getUint16(offset + 8, true);
	const crc32 = view.getUint32(offset + 14, true);
	const compressedSize = view.getUint32(offset + 18, true);
	const uncompressedSize = view.getUint32(offset + 22, true);
	const nameLength = view.getUint16(offset + 26, true);
	const extraLength = view.getUint16(offset + 28, true);
	const variableLength = nameLength + extraLength;
	requireRange(bytes, offset + LOCAL_FILE_HEADER_FIXED_SIZE, variableLength, "local file header");
	const nameStart = offset + LOCAL_FILE_HEADER_FIXED_SIZE;
	const localName = bytes.subarray(nameStart, nameStart + nameLength);
	const localExtra = bytes.subarray(nameStart + nameLength, nameStart + variableLength);
	if (containsZip64ExtraField(localExtra)) invalidZip("ZIP64 extra fields are not supported");
	if (!sameBytes(localName, entry.name)) invalidZip("local and central file names disagree");
	if (flags !== entry.flags || compressionMethod !== entry.compressionMethod) {
		invalidZip("local and central file metadata disagree");
	}
	if ((flags & 0x0008) === 0) {
		if (
			crc32 !== entry.crc32 ||
			compressedSize !== entry.compressedSize ||
			uncompressedSize !== entry.uncompressedSize
		) {
			invalidZip("local and central file sizes disagree");
		}
	} else if (compressedSize === MAX_UINT32 || uncompressedSize === MAX_UINT32) {
		invalidZip("ZIP64 local file sizes are not supported");
	}
	const dataStart = nameStart + variableLength;
	const dataEnd = dataStart + entry.compressedSize;
	if (!Number.isSafeInteger(dataEnd) || dataEnd > centralOffset) {
		invalidZip("file payload is truncated or overlaps the central directory");
	}
	return { start: offset, end: dataEnd };
}

/** Inspects an in-memory ordinary ZIP without decompressing any entry payload. */
export function inspectCatalogPrivateZip(bytes: Uint8Array): CatalogPrivateZipInspection {
	const view = viewOf(bytes);
	const eocdOffset = findEndOfCentralDirectory(bytes, view);
	if (
		eocdOffset >= 20 &&
		view.getUint32(eocdOffset - 20, true) === ZIP64_END_OF_CENTRAL_DIRECTORY_LOCATOR_SIGNATURE
	) {
		invalidZip("ZIP64 structures are not supported");
	}

	const diskNumber = view.getUint16(eocdOffset + 4, true);
	const centralDirectoryDisk = view.getUint16(eocdOffset + 6, true);
	const entriesOnDisk = view.getUint16(eocdOffset + 8, true);
	const entryCount = view.getUint16(eocdOffset + 10, true);
	const centralDirectorySize = view.getUint32(eocdOffset + 12, true);
	const centralDirectoryOffset = view.getUint32(eocdOffset + 16, true);
	if (
		entriesOnDisk === MAX_UINT16 ||
		entryCount === MAX_UINT16 ||
		centralDirectorySize === MAX_UINT32 ||
		centralDirectoryOffset === MAX_UINT32
	) {
		invalidZip("ZIP64 structures are not supported");
	}
	if (diskNumber !== 0 || centralDirectoryDisk !== 0 || entriesOnDisk !== entryCount) {
		invalidZip("multi-disk archives are not supported");
	}
	if (centralDirectoryOffset + centralDirectorySize !== eocdOffset) {
		invalidZip("central directory bounds do not match the end record");
	}
	requireRange(bytes, centralDirectoryOffset, centralDirectorySize, "central directory");

	let cursor = centralDirectoryOffset;
	let totalUncompressedBytes = 0;
	let maximumEntryCompressionRatio = 1;
	let encryptedEntryCount = 0;
	let unsafePathCount = 0;
	let duplicatePathCount = 0;
	const normalizedPaths = new Set<string>();
	const localSpans: Array<{ start: number; end: number }> = [];

	for (let index = 0; index < entryCount; index += 1) {
		requireRange(bytes, cursor, CENTRAL_DIRECTORY_FILE_HEADER_FIXED_SIZE, "central file header");
		if (view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_FILE_HEADER_SIGNATURE) {
			invalidZip("central file header signature is malformed");
		}
		const flags = view.getUint16(cursor + 8, true);
		const compressionMethod = view.getUint16(cursor + 10, true);
		const crc32 = view.getUint32(cursor + 16, true);
		const compressedSize = view.getUint32(cursor + 20, true);
		const uncompressedSize = view.getUint32(cursor + 24, true);
		const nameLength = view.getUint16(cursor + 28, true);
		const extraLength = view.getUint16(cursor + 30, true);
		const commentLength = view.getUint16(cursor + 32, true);
		const diskStart = view.getUint16(cursor + 34, true);
		const localHeaderOffset = view.getUint32(cursor + 42, true);
		if (
			compressedSize === MAX_UINT32 ||
			uncompressedSize === MAX_UINT32 ||
			localHeaderOffset === MAX_UINT32 ||
			diskStart === MAX_UINT16
		) {
			invalidZip("ZIP64 entry fields are not supported");
		}
		if (diskStart !== 0) invalidZip("multi-disk entries are not supported");
		if (nameLength === 0) invalidZip("entry file name is empty");
		const variableLength = nameLength + extraLength + commentLength;
		requireRange(
			bytes,
			cursor + CENTRAL_DIRECTORY_FILE_HEADER_FIXED_SIZE,
			variableLength,
			"central file header",
		);
		const nameStart = cursor + CENTRAL_DIRECTORY_FILE_HEADER_FIXED_SIZE;
		const name = bytes.subarray(nameStart, nameStart + nameLength);
		const extra = bytes.subarray(nameStart + nameLength, nameStart + nameLength + extraLength);
		if (containsZip64ExtraField(extra)) invalidZip("ZIP64 extra fields are not supported");

		const entry: CentralDirectoryEntry = {
			flags,
			compressionMethod,
			crc32,
			compressedSize,
			uncompressedSize,
			name,
			localHeaderOffset,
		};
		localSpans.push(validateLocalEntry(bytes, entry, centralDirectoryOffset));
		totalUncompressedBytes += uncompressedSize;
		maximumEntryCompressionRatio = Math.max(
			maximumEntryCompressionRatio,
			uncompressedSize / Math.max(1, compressedSize),
		);
		if ((flags & 0x0001) !== 0) encryptedEntryCount += 1;
		const path = pathFacts(name);
		if (path.unsafe) unsafePathCount += 1;
		if (normalizedPaths.has(path.normalizedPath)) duplicatePathCount += 1;
		else normalizedPaths.add(path.normalizedPath);
		cursor += CENTRAL_DIRECTORY_FILE_HEADER_FIXED_SIZE + variableLength;
	}
	if (cursor !== centralDirectoryOffset + centralDirectorySize) {
		invalidZip("central directory size or entry count is inconsistent");
	}

	localSpans.sort((left, right) => left.start - right.start);
	for (let index = 1; index < localSpans.length; index += 1) {
		const previous = localSpans[index - 1];
		const current = localSpans[index];
		if (previous && current && previous.end > current.start) {
			invalidZip("local file entries overlap");
		}
	}

	return {
		entryCount,
		totalUncompressedBytes,
		maximumEntryCompressionRatio,
		encryptedEntryCount,
		unsafePathCount,
		duplicatePathCount,
	};
}
