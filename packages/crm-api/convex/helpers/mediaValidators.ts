import type { Infer } from "convex/values";
import { v } from "convex/values";

export const mediaAssetStatusValidator = v.union(
	v.literal("ready"),
	v.literal("deleting"),
);

export const webImageContentTypeValidator = v.union(
	v.literal("image/jpeg"),
	v.literal("image/png"),
	v.literal("image/webp"),
);

export const webAssetSourceValidator = v.object({
	contentType: webImageContentTypeValidator,
	sizeBytes: v.number(),
	width: v.number(),
	height: v.number(),
});

export const webAssetMasterValidator = v.object({
	key: v.string(),
	contentType: v.literal("image/webp"),
	sizeBytes: v.number(),
	width: v.number(),
	height: v.number(),
});

export const webAssetDerivativeValidator = v.object({
	key: v.string(),
	contentType: v.literal("image/webp"),
	width: v.number(),
	height: v.number(),
});

export const webAssetDerivativesValidator = v.object({
	thumb: webAssetDerivativeValidator,
	card: webAssetDerivativeValidator,
	display1280: webAssetDerivativeValidator,
	display2048: webAssetDerivativeValidator,
	display2560: webAssetDerivativeValidator,
});

export const readyWebAssetValidator = v.object({
	assetId: v.string(),
	originalFilename: v.string(),
	source: webAssetSourceValidator,
	master: webAssetMasterValidator,
	derivatives: webAssetDerivativesValidator,
});

export const mediaFocalPointValidator = v.object({
	x: v.number(),
	y: v.number(),
});

export type ReadyWebAsset = Infer<typeof readyWebAssetValidator>;

const ASSET_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const WEB_UPLOAD_MAX_SIZE_BYTES = 20_000_000;
const NORMALIZED_MASTER_MAX_WIDTH = 4096;
const FILENAME_MAX_LENGTH = 255;

const DERIVATIVE_SPECS = {
	thumb: { filename: "thumb.webp", width: 320 },
	card: { filename: "card.webp", width: 768 },
	display1280: { filename: "display-1280.webp", width: 1280 },
	display2048: { filename: "display-2048.webp", width: 2048 },
	display2560: { filename: "display-2560.webp", width: 2560 },
} as const;

function requirePositiveSafeInteger(value: number, field: string) {
	if (!Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${field} must be a positive integer`);
	}
}

function scaledDimensions(width: number, height: number, maxWidth: number) {
	const outputWidth = Math.min(width, maxWidth);
	return {
		width: outputWidth,
		height: Math.max(1, Math.round(height * (outputWidth / width))),
	};
}

function dimensionsMatchWithinImagePipelineRounding(
	actual: { width: number; height: number },
	expected: { width: number; height: number },
) {
	return actual.width === expected.width && Math.abs(actual.height - expected.height) <= 1;
}

export function validateReadyWebAsset(siteUrl: string, asset: ReadyWebAsset) {
	if (!ASSET_ID_PATTERN.test(asset.assetId)) {
		throw new Error("Media asset ID must be a canonical UUID v4");
	}
	if (
		asset.originalFilename.length === 0
		|| asset.originalFilename.length > FILENAME_MAX_LENGTH
		|| asset.originalFilename !== asset.originalFilename.trim()
		|| asset.originalFilename.includes("/")
		|| asset.originalFilename.includes("\\")
	) throw new Error("Original filename is invalid");

	requirePositiveSafeInteger(asset.source.sizeBytes, "Source size");
	if (asset.source.sizeBytes > WEB_UPLOAD_MAX_SIZE_BYTES) {
		throw new Error("Source exceeds the web-image upload limit");
	}
	requirePositiveSafeInteger(asset.source.width, "Source width");
	requirePositiveSafeInteger(asset.source.height, "Source height");
	requirePositiveSafeInteger(asset.master.sizeBytes, "Master size");
	requirePositiveSafeInteger(asset.master.width, "Master width");
	requirePositiveSafeInteger(asset.master.height, "Master height");

	const prefix = `sites/${siteUrl}/web/${asset.assetId}/`;
	if (asset.master.key !== `${prefix}master.webp`) {
		throw new Error("Private master key does not match its tenant and asset");
	}
	const masterDimensions = scaledDimensions(
		asset.source.width,
		asset.source.height,
		NORMALIZED_MASTER_MAX_WIDTH,
	);
	if (
		!dimensionsMatchWithinImagePipelineRounding(asset.master, masterDimensions)
	) throw new Error("Private master dimensions do not match the source");

	for (const [name, spec] of Object.entries(DERIVATIVE_SPECS) as Array<
		[keyof typeof DERIVATIVE_SPECS, (typeof DERIVATIVE_SPECS)[keyof typeof DERIVATIVE_SPECS]]
	>) {
		const derivative = asset.derivatives[name];
		const dimensions = scaledDimensions(asset.source.width, asset.source.height, spec.width);
		if (derivative.key !== `${prefix}${spec.filename}`) {
			throw new Error(`${name} key does not match its tenant and asset`);
		}
		if (derivative.width !== dimensions.width || derivative.height !== dimensions.height) {
			throw new Error(`${name} dimensions do not match the source`);
		}
	}
}
