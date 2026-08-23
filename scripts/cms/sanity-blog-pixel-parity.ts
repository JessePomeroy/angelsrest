import { createHash } from "node:crypto";
import { lstat, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const EXPECTED_SOURCE_SHA256 = "f95bd3c00ab012fb8c31a3a7f9cbd35e3ec41997b1e1767bcd554f3c76d4ec4a";
const EXPECTED_TARGET_SHA256 = "6d5862a904f23f4332902d4c39b7a3f9088549f751c04cd624c40af9f356a6b5";
const EXPECTED_TARGET_BYTES = 573_928;
const EXPECTED_WIDTH = 2880;
const EXPECTED_HEIGHT = 1492;
const MAX_BYTES = 8 * 1024 * 1024;

function sha256(value: Uint8Array) {
	return createHash("sha256").update(value).digest("hex");
}

async function decodedPixels(bytes: Uint8Array) {
	const { data, info } = await sharp(bytes, { failOn: "error", limitInputPixels: 5_000_000 })
		.rotate()
		.toColourspace("srgb")
		.removeAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	if (
		info.width !== EXPECTED_WIDTH ||
		info.height !== EXPECTED_HEIGHT ||
		info.channels !== 3 ||
		data.byteLength !== EXPECTED_WIDTH * EXPECTED_HEIGHT * 3
	) {
		throw new Error("Decoded image geometry differs from the accepted source");
	}
	return data;
}

async function assertExactTargetMaster(bytes: Uint8Array) {
	if (bytes.byteLength !== EXPECTED_TARGET_BYTES || sha256(bytes) !== EXPECTED_TARGET_SHA256) {
		throw new Error("Target bytes do not match the exact private R2 master");
	}
	const metadata = await sharp(bytes, { failOn: "error", limitInputPixels: 5_000_000 }).metadata();
	if (
		metadata.format !== "webp" ||
		metadata.width !== EXPECTED_WIDTH ||
		metadata.height !== EXPECTED_HEIGHT
	) {
		throw new Error("Target is not the exact expected WebP master geometry");
	}
}

export function compareDecodedPixelBuffers(source: Uint8Array, target: Uint8Array) {
	if (source.byteLength !== target.byteLength) return false;
	return Buffer.from(source).equals(Buffer.from(target));
}

export function measureDecodedPixelFidelity(source: Uint8Array, target: Uint8Array) {
	if (source.byteLength === 0 || source.byteLength !== target.byteLength) {
		throw new Error("Decoded image sample counts differ");
	}
	let absoluteError = 0;
	let squaredError = 0;
	let maximumDifference = 0;
	let withinEight = 0;
	let withinSixteen = 0;
	for (let index = 0; index < source.byteLength; index += 1) {
		const difference = Math.abs((source[index] ?? 0) - (target[index] ?? 0));
		absoluteError += difference;
		squaredError += difference * difference;
		maximumDifference = Math.max(maximumDifference, difference);
		if (difference <= 8) withinEight += 1;
		if (difference <= 16) withinSixteen += 1;
	}
	const meanAbsoluteError = absoluteError / source.byteLength;
	const meanSquaredError = squaredError / source.byteLength;
	const peakSignalToNoiseRatio =
		meanSquaredError === 0 ? null : 10 * Math.log10((255 * 255) / meanSquaredError);
	return {
		meanAbsoluteError,
		meanSquaredError,
		peakSignalToNoiseRatio,
		maximumDifference,
		withinEightFraction: withinEight / source.byteLength,
		withinSixteenFraction: withinSixteen / source.byteLength,
	};
}

export function hasExpectedLossyWebpFidelity(
	metrics: ReturnType<typeof measureDecodedPixelFidelity>,
) {
	return (
		metrics.meanAbsoluteError <= 2 &&
		metrics.peakSignalToNoiseRatio !== null &&
		metrics.peakSignalToNoiseRatio >= 38 &&
		metrics.withinEightFraction >= 0.98 &&
		metrics.withinSixteenFraction >= 0.995
	);
}

export function pixelParityOptions(args: string[]) {
	let out: string | undefined;
	let sourceFile: string | undefined;
	let targetFile: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--out") out = args[++index];
		else if (args[index] === "--source-file") sourceFile = args[++index];
		else if (args[index] === "--target-file") targetFile = args[++index];
		else throw new Error(`Unsupported argument: ${args[index]}`);
	}
	if (!out || !sourceFile || !targetFile) {
		throw new Error(
			"Usage: --source-file <fresh-source.png> --target-file <private-master.webp> --out <new-report.json>",
		);
	}
	const resolvedSource = resolve(sourceFile);
	const resolvedTarget = resolve(targetFile);
	if (resolvedSource === resolvedTarget) {
		throw new Error("Source and target pixel-proof inputs must be distinct files");
	}
	return { out: resolve(out), sourceFile: resolvedSource, targetFile: resolvedTarget };
}

async function readPrivateImage(path: string) {
	const metadata = await lstat(path);
	if (
		!metadata.isFile() ||
		metadata.isSymbolicLink() ||
		metadata.nlink !== 1 ||
		metadata.uid !== process.getuid?.() ||
		(metadata.mode & 0o077) !== 0 ||
		metadata.size <= 0 ||
		metadata.size > MAX_BYTES
	) {
		throw new Error("Pixel proof input must be one owner-only regular file");
	}
	return new Uint8Array(await readFile(path));
}

async function main() {
	const { out, sourceFile, targetFile } = pixelParityOptions(process.argv.slice(2));
	const [sourceBytes, targetBytes] = await Promise.all([
		readPrivateImage(sourceFile),
		readPrivateImage(targetFile),
	]);
	const sourceSha256 = sha256(sourceBytes);
	if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
		throw new Error("Current Sanity PNG bytes drifted from the accepted mapping proposal");
	}
	await assertExactTargetMaster(targetBytes);
	const [sourcePixels, targetPixels] = await Promise.all([
		decodedPixels(sourceBytes),
		decodedPixels(targetBytes),
	]);
	const sourcePixelSha256 = sha256(sourcePixels);
	const targetPixelSha256 = sha256(targetPixels);
	const decodedPixelEquality = compareDecodedPixelBuffers(sourcePixels, targetPixels);
	const fidelity = measureDecodedPixelFidelity(sourcePixels, targetPixels);
	if (!decodedPixelEquality && !hasExpectedLossyWebpFidelity(fidelity)) {
		throw new Error("Target master differs beyond the accepted WebP normalization envelope");
	}
	const report = {
		schema: "angelsrest.r6.blog-pixel-parity.v1",
		observedAtUtc: new Date().toISOString(),
		source: {
			assetRef: "image-35e637d5107bdbcc18a316d85b4eee2115222360-2880x1492-png",
			sha256: sourceSha256,
			bytes: sourceBytes.byteLength,
			width: EXPECTED_WIDTH,
			height: EXPECTED_HEIGHT,
			pixelSha256: sourcePixelSha256,
		},
		target: {
			mediaAssetId: "nh71hrsmf1vnc8k62v2f6wrkp18asxer",
			workerAssetId: "fb751126-d9a3-41a1-806d-9529f08a9449",
			privateObjectKey:
				"sites/angelsrest.online/web/fb751126-d9a3-41a1-806d-9529f08a9449/master.webp",
			sha256: sha256(targetBytes),
			bytes: targetBytes.byteLength,
			width: EXPECTED_WIDTH,
			height: EXPECTED_HEIGHT,
			pixelSha256: targetPixelSha256,
		},
		decodedPixelEquality,
		lossyWebpNormalizationExpected: true,
		exactPixelEqualityClaimed: decodedPixelEquality,
		lossyWebpFidelityWithinThreshold: !decodedPixelEquality,
		fidelity,
		fidelityThresholds: {
			maximumMeanAbsoluteError: 2,
			minimumPeakSignalToNoiseRatio: 38,
			minimumWithinEightFraction: 0.98,
			minimumWithinSixteenFraction: 0.995,
		},
		encodedByteEqualityClaimed: false,
	};
	await writeFile(out, `${JSON.stringify(report, null, 2)}\n`, {
		flag: "wx",
		mode: 0o600,
	});
	console.log(sourcePixelSha256);
}

if (process.env.VITEST === undefined) {
	void main().catch((error) => {
		console.error(error instanceof Error ? error.message : "Pixel parity check failed");
		process.exitCode = 1;
	});
}
