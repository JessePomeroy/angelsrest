import { createHash } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import sharp from "sharp";

const SOURCE_URL =
	"https://cdn.sanity.io/images/n7rvza4g/production/35e637d5107bdbcc18a316d85b4eee2115222360-2880x1492.png";
const TARGET_URL =
	"https://media.angelsrest.online/sites/angelsrest.online/web/fb751126-d9a3-41a1-806d-9529f08a9449/master.webp";
const EXPECTED_SOURCE_SHA256 = "f95bd3c00ab012fb8c31a3a7f9cbd35e3ec41997b1e1767bcd554f3c76d4ec4a";
const EXPECTED_WIDTH = 2880;
const EXPECTED_HEIGHT = 1492;
const MAX_BYTES = 8 * 1024 * 1024;

function sha256(value: Uint8Array) {
	return createHash("sha256").update(value).digest("hex");
}

async function download(url: string) {
	const response = await fetch(url, {
		method: "GET",
		headers: { accept: "image/png,image/webp" },
		redirect: "error",
		signal: AbortSignal.timeout(30_000),
	});
	if (!response.ok) throw new Error(`Image read failed with HTTP ${response.status}`);
	const length = Number(response.headers.get("content-length"));
	if (Number.isFinite(length) && (length <= 0 || length > MAX_BYTES)) {
		throw new Error("Image response size is outside the accepted bound");
	}
	const bytes = new Uint8Array(await response.arrayBuffer());
	if (bytes.byteLength === 0 || bytes.byteLength > MAX_BYTES) {
		throw new Error("Image response size is outside the accepted bound");
	}
	return bytes;
}

async function decodedPixels(bytes: Uint8Array) {
	const { data, info } = await sharp(bytes, { failOn: "error", limitInputPixels: 5_000_000 })
		.rotate()
		.toColourspace("srgb")
		.ensureAlpha()
		.raw()
		.toBuffer({ resolveWithObject: true });
	if (
		info.width !== EXPECTED_WIDTH ||
		info.height !== EXPECTED_HEIGHT ||
		info.channels !== 4 ||
		data.byteLength !== EXPECTED_WIDTH * EXPECTED_HEIGHT * 4
	) {
		throw new Error("Decoded image geometry differs from the accepted source");
	}
	return data;
}

export function compareDecodedPixelBuffers(source: Uint8Array, target: Uint8Array) {
	if (source.byteLength !== target.byteLength) return false;
	return Buffer.from(source).equals(Buffer.from(target));
}

function outputPath(args: string[]) {
	if (args.length !== 2 || args[0] !== "--out" || !args[1]) {
		throw new Error("Usage: --out <new-report.json>");
	}
	return resolve(args[1]);
}

async function main() {
	const out = outputPath(process.argv.slice(2));
	const [sourceBytes, targetBytes] = await Promise.all([
		download(SOURCE_URL),
		download(TARGET_URL),
	]);
	const sourceSha256 = sha256(sourceBytes);
	if (sourceSha256 !== EXPECTED_SOURCE_SHA256) {
		throw new Error("Current Sanity PNG bytes drifted from the accepted mapping proposal");
	}
	const [sourcePixels, targetPixels] = await Promise.all([
		decodedPixels(sourceBytes),
		decodedPixels(targetBytes),
	]);
	const sourcePixelSha256 = sha256(sourcePixels);
	const targetPixelSha256 = sha256(targetPixels);
	if (!compareDecodedPixelBuffers(sourcePixels, targetPixels)) {
		throw new Error("Target master pixels differ from the current Sanity PNG");
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
			sha256: sha256(targetBytes),
			bytes: targetBytes.byteLength,
			width: EXPECTED_WIDTH,
			height: EXPECTED_HEIGHT,
			pixelSha256: targetPixelSha256,
		},
		decodedPixelParity: true,
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
