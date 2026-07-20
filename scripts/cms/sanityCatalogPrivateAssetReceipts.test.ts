import { createHash } from "node:crypto";
import { describe, expect, test } from "vitest";
import type {
	SanityCatalogImportIssue,
	SanityCatalogImportManifest,
	SanityCatalogImportProduct,
} from "../../packages/crm-api/convex/helpers/sanityCatalogImport";
import {
	ANGELS_REST_CATALOG_SITE_URL,
	type CatalogPrivateAssetByteEvidence,
	createSanityCatalogPrivateAssetReceiptSet,
	hashCatalogPrivateAssetByteStream,
} from "./sanityCatalogPrivateAssetReceipts";

const SITE_URL = ANGELS_REST_CATALOG_SITE_URL;
const ACTOR = "cms-catalog-migration";
const RECORDED_AT = 1_784_496_000_000;
const PAID_REF = `file-${"f".repeat(40)}-zip`;
const PRINT_REFS = Array.from(
	{ length: 11 },
	(_, index) => `image-${(index + 1).toString(16).padStart(40, "0")}-1200x800-jpg`,
);
const encoder = new TextEncoder();

function bytesFor(sourceAssetRef: string) {
	return encoder.encode(`private catalog bytes for ${sourceAssetRef}`);
}

function sha256(bytes: Uint8Array) {
	return createHash("sha256").update(bytes).digest("hex");
}

async function* byteStream(bytes: Uint8Array, splitAt = bytes.byteLength) {
	yield bytes.subarray(0, splitAt);
	if (splitAt < bytes.byteLength) yield bytes.subarray(splitAt);
}

function printProduct(index: number, sourceAssetRef: string): SanityCatalogImportProduct {
	return {
		sourcePath: `$.prints[${index}]`,
		sourceId: `print-${index}`,
		sourceType: "lumaProductV2",
		sourceRevision: `product-revision-${index}`,
		productKey: `print-${index}`,
		kind: "print",
		fulfillmentMode: "production_partner",
		title: `Print ${index}`,
		slug: `print-${index}`,
		saleAvailability: "available",
		shopPlacement: { featured: false },
		variants: [],
		media: [
			{
				key: `image-${index}`,
				role: "primary",
				order: 0,
				sourceAssetRef,
				sourceAssetId: sourceAssetRef,
				sourceAssetRevision: `asset-revision-${index}`,
				altText: `Print ${index}.`,
				printSource: true,
			},
		],
		printOptions: {
			borderOptionsEnabled: false,
			frameOptionsEnabled: false,
			framePriceMultiplierBasisPoints: 10_000,
		},
		normalizations: [],
		issues: [],
	};
}

function digitalProduct(): SanityCatalogImportProduct {
	const bytes = bytesFor(PAID_REF);
	return {
		sourcePath: "$.general[0]",
		sourceId: "digital-1",
		sourceType: "product",
		sourceRevision: "product-revision-digital-1",
		productKey: "digital-1",
		kind: "digital_download",
		fulfillmentMode: "digital_delivery",
		title: "Digital archive",
		slug: "digital-archive",
		saleAvailability: "available",
		shopPlacement: { featured: false },
		variants: [],
		media: [],
		digitalFile: {
			sourceFileRef: PAID_REF,
			sourceAssetId: PAID_REF,
			sourceAssetRevision: "asset-revision-paid-file",
			originalFilename: "time-aware-theme.zip",
			mimeType: "application/zip",
			sizeBytes: bytes.byteLength,
			version: "1.0.0",
		},
		normalizations: [],
		issues: [],
	};
}

function manifest(): SanityCatalogImportManifest {
	return {
		version: 1,
		products: [
			...PRINT_REFS.map((sourceAssetRef, index) => printProduct(index, sourceAssetRef)),
			digitalProduct(),
		],
		sourceExtras: { collections: 0, coupons: 0 },
		issues: [],
	};
}

function evidence({
	reverse = false,
	split = false,
	overrides = new Map<string, Uint8Array>(),
}: {
	reverse?: boolean;
	split?: boolean;
	overrides?: ReadonlyMap<string, Uint8Array>;
} = {}): CatalogPrivateAssetByteEvidence[] {
	const items: CatalogPrivateAssetByteEvidence[] = [
		...PRINT_REFS.map((sourceAssetRef) => {
			const bytes = overrides.get(sourceAssetRef) ?? bytesFor(sourceAssetRef);
			return {
				kind: "print_source" as const,
				sourceAssetRef,
				bytes: byteStream(bytes, split ? Math.floor(bytes.byteLength / 2) : bytes.byteLength),
				observedMimeType: "image/jpeg" as const,
				observedWidthPixels: 1200,
				observedHeightPixels: 800,
			};
		}),
		{
			kind: "paid_digital_file",
			sourceAssetRef: PAID_REF,
			bytes: byteStream(bytesFor(PAID_REF), split ? 3 : bytesFor(PAID_REF).byteLength),
			observedMimeType: "application/zip",
		},
	];
	return reverse ? items.reverse() : items;
}

function withCountingStreams(items: CatalogPrivateAssetByteEvidence[]) {
	const counter = { nextCalls: 0 };
	const bytes: AsyncIterable<Uint8Array> = {
		[Symbol.asyncIterator]() {
			return {
				async next() {
					counter.nextCalls += 1;
					return { done: true as const, value: undefined };
				},
			};
		},
	};
	return {
		counter,
		items: items.map((item) => ({ ...item, bytes })) as CatalogPrivateAssetByteEvidence[],
	};
}

function createReceiptSet(
	input: {
		manifest?: SanityCatalogImportManifest;
		evidence?: CatalogPrivateAssetByteEvidence[];
		siteUrl?: string;
		actorIdentity?: string;
		recordedAt?: number;
	} = {},
) {
	return createSanityCatalogPrivateAssetReceiptSet({
		manifest: input.manifest ?? manifest(),
		evidence: input.evidence ?? evidence(),
		siteUrl: input.siteUrl ?? SITE_URL,
		actorIdentity: input.actorIdentity ?? ACTOR,
		recordedAt: input.recordedAt ?? RECORDED_AT,
	});
}

describe("Sanity catalog private-asset receipt candidates", () => {
	test("builds the exact deduplicated 11-print-source and one-paid-file candidate set", async () => {
		const result = await createReceiptSet();

		expect(result.receipts).toHaveLength(12);
		expect(result.receipts.filter((receipt) => receipt.kind === "print_source")).toHaveLength(11);
		expect(result.receipts.at(-1)).toMatchObject({
			kind: "paid_digital_file",
			sourceAssetRef: PAID_REF,
			target: {
				siteUrl: SITE_URL,
				assetKey: PAID_REF,
				privateObjectKey: `sites/${SITE_URL}/catalog/paid-digital-files/${PAID_REF}/original`,
				status: "verified",
				originalFilename: "time-aware-theme.zip",
				mimeType: "application/zip",
				sizeBytes: bytesFor(PAID_REF).byteLength,
				sha256: sha256(bytesFor(PAID_REF)),
				version: "1.0.0",
				provenance: {
					provider: "sanity",
					sourceId: PAID_REF,
					sourceRevision: "asset-revision-paid-file",
				},
			},
		});
		const first = result.receipts[0];
		expect(first).toMatchObject({
			kind: "print_source",
			sourceAssetRef: PRINT_REFS[0],
			target: {
				assetKey: PRINT_REFS[0],
				privateObjectKey: `sites/${SITE_URL}/catalog/print-sources/${PRINT_REFS[0]}/original`,
				originalFilename: `${"0".repeat(39)}1-1200x800.jpg`,
				mimeType: "image/jpeg",
				widthPixels: 1200,
				heightPixels: 800,
				sha256: sha256(bytesFor(PRINT_REFS[0])),
			},
		});
		expect(first?.target.provenance).toEqual({
			provider: "sanity",
			sourceId: PRINT_REFS[0],
			sourceRevision: "asset-revision-0",
		});
		expect(first?.target.provenance.sourceRevision).not.toBe(
			manifest().products[0]?.sourceRevision,
		);
		expect(result.candidateChecksum).toMatch(/^[0-9a-f]{64}$/);
	});

	test("checksum-binds each asset revision rather than a product revision", async () => {
		const original = await createReceiptSet();
		const revisedManifest = manifest();
		const placement = revisedManifest.products[0]?.media[0];
		if (!placement) throw new Error("Fixture is missing its first placement");
		placement.sourceAssetRevision = "asset-revision-0-next";
		const revised = await createReceiptSet({ manifest: revisedManifest });

		expect(revised.receipts[0]?.target.provenance).toMatchObject({
			sourceRevision: "asset-revision-0-next",
		});
		expect(revised.candidateChecksum).not.toBe(original.candidateChecksum);
	});

	test("is stable across evidence order and stream chunk boundaries", async () => {
		const whole = await createReceiptSet();
		const chunkedAndReversed = await createReceiptSet({
			evidence: evidence({ reverse: true, split: true }),
		});

		expect(chunkedAndReversed).toEqual(whole);
	});

	test("computes size and digest internally and makes byte tampering checksum-visible", async () => {
		const original = await createReceiptSet();
		const replacement = encoder.encode("tampered catalog bytes with the same authority boundary");
		const tampered = await createReceiptSet({
			evidence: evidence({ overrides: new Map([[PRINT_REFS[0], replacement]]) }),
		});
		const originalPrint = original.receipts[0]?.target;
		const tamperedPrint = tampered.receipts[0]?.target;

		expect(tamperedPrint?.sizeBytes).toBe(replacement.byteLength);
		expect(tamperedPrint?.sha256).toBe(sha256(replacement));
		expect(tamperedPrint?.sha256).not.toBe(originalPrint?.sha256);
		expect(tampered.candidateChecksum).not.toBe(original.candidateChecksum);
	});

	test("rejects missing, extra, duplicate, and cross-wired byte evidence before streaming", async () => {
		await expect(createReceiptSet({ evidence: evidence().slice(1) })).rejects.toThrow(/missing/i);
		const extraRef = `image-${"e".repeat(40)}-1200x800-jpg`;
		await expect(
			createReceiptSet({
				evidence: [
					...evidence(),
					{
						kind: "print_source",
						sourceAssetRef: extraRef,
						bytes: byteStream(bytesFor(extraRef)),
						observedMimeType: "image/jpeg",
						observedWidthPixels: 1200,
						observedHeightPixels: 800,
					},
				],
			}),
		).rejects.toThrow(/extra/i);
		await expect(
			createReceiptSet({
				evidence: [...evidence(), evidence()[0] as CatalogPrivateAssetByteEvidence],
			}),
		).rejects.toThrow(/duplicate/i);
		await expect(
			createReceiptSet({
				evidence: [
					...evidence().slice(0, -1),
					{
						kind: "print_source",
						sourceAssetRef: PAID_REF,
						bytes: byteStream(bytesFor(PAID_REF)),
						observedMimeType: "image/jpeg",
						observedWidthPixels: 1200,
						observedHeightPixels: 800,
					},
				],
			}),
		).rejects.toThrow(/cross-wires/i);
	});

	test("deduplicates repeated print references and rejects conflicting repeated provenance", async () => {
		const repeated = manifest();
		const placement = repeated.products[0]?.media[0];
		if (!placement) throw new Error("Fixture is missing its first placement");
		repeated.products[1]?.media.push({ ...placement, key: "repeated", order: 1 });
		const result = await createReceiptSet({ manifest: repeated });
		expect(result.receipts).toHaveLength(12);

		const conflicting = manifest();
		const conflictingPlacement = conflicting.products[0]?.media[0];
		if (!conflictingPlacement) throw new Error("Fixture is missing its first placement");
		conflicting.products[1]?.media.push({
			...conflictingPlacement,
			key: "conflict",
			order: 1,
			sourceAssetRevision: "different-revision",
		});
		await expect(createReceiptSet({ manifest: conflicting })).rejects.toThrow(/conflicting facts/i);
	});

	test.each([
		[
			"asset revision",
			(file: NonNullable<SanityCatalogImportProduct["digitalFile"]>) => {
				file.sourceAssetRevision = "different-revision";
			},
		],
		[
			"filename",
			(file: NonNullable<SanityCatalogImportProduct["digitalFile"]>) => {
				file.originalFilename = "different-name.zip";
			},
		],
		[
			"MIME type",
			(file: NonNullable<SanityCatalogImportProduct["digitalFile"]>) => {
				file.mimeType = "application/pdf";
			},
		],
		[
			"byte count",
			(file: NonNullable<SanityCatalogImportProduct["digitalFile"]>) => {
				file.sizeBytes += 1;
			},
		],
		[
			"version",
			(file: NonNullable<SanityCatalogImportProduct["digitalFile"]>) => {
				file.version = "2.0.0";
			},
		],
	] as const)("rejects conflicting repeated paid-file %s", async (_field, mutate) => {
		const repeated = manifest();
		const duplicate = digitalProduct();
		duplicate.sourceId = "digital-2";
		duplicate.productKey = "digital-2";
		duplicate.sourcePath = "$.general[1]";
		if (!duplicate.digitalFile) throw new Error("Fixture is missing its paid file");
		mutate(duplicate.digitalFile);
		repeated.products.push(duplicate);

		await expect(createReceiptSet({ manifest: repeated })).rejects.toThrow(/conflicting facts/i);
	});

	test("requires ready manifest provenance and the exact tenant namespace contract", async () => {
		const blocked = manifest();
		const issue: SanityCatalogImportIssue = {
			code: "missing-required-field",
			path: "$.prints[0].title",
			message: "Missing title",
			severity: "error",
		};
		blocked.products[0]?.issues.push(issue);
		await expect(createReceiptSet({ manifest: blocked })).rejects.toThrow(/ready/i);

		const mismatchedIdentity = manifest();
		const placement = mismatchedIdentity.products[0]?.media[0];
		if (!placement) throw new Error("Fixture is missing its first placement");
		placement.sourceAssetId = PRINT_REFS[1] as string;
		await expect(createReceiptSet({ manifest: mismatchedIdentity })).rejects.toThrow(/asset ID/i);

		await expect(createReceiptSet({ siteUrl: "other.example" })).rejects.toThrow(/fixed to/i);
		await expect(createReceiptSet({ actorIdentity: " migration actor " })).rejects.toThrow(
			/trimmed/i,
		);
	});

	test("completes all static preflight checks before pulling any one-shot stream", async () => {
		const assertNoPulls = async (
			input: Parameters<typeof createReceiptSet>[0],
			message: RegExp,
		) => {
			const counted = withCountingStreams(input.evidence ?? evidence());
			await expect(createReceiptSet({ ...input, evidence: counted.items })).rejects.toThrow(
				message,
			);
			expect(counted.counter.nextCalls).toBe(0);
		};

		await assertNoPulls({ siteUrl: "other.example" }, /fixed to/i);
		await assertNoPulls({ actorIdentity: " actor " }, /trimmed/i);
		await assertNoPulls({ recordedAt: -1 }, /timestamp/i);
		await assertNoPulls({ recordedAt: -1 }, /timestamp/i);

		const filenameManifest = manifest();
		const filename = filenameManifest.products.at(-1)?.digitalFile;
		if (!filename) throw new Error("Fixture is missing its paid file");
		filename.originalFilename = "../archive.zip";
		await assertNoPulls({ manifest: filenameManifest }, /path/i);

		const versionManifest = manifest();
		const version = versionManifest.products.at(-1)?.digitalFile;
		if (!version) throw new Error("Fixture is missing its paid file");
		version.version = "v".repeat(65);
		await assertNoPulls({ manifest: versionManifest }, /version/i);

		const dimensionsManifest = manifest();
		const placement = dimensionsManifest.products[10]?.media[0];
		if (!placement) throw new Error("Fixture is missing its last print placement");
		const oversizedRef = `image-${"b".repeat(40)}-100001x800-jpg`;
		placement.sourceAssetRef = oversizedRef;
		placement.sourceAssetId = oversizedRef;
		const dimensionEvidence = evidence();
		const lastPrint = dimensionEvidence[10];
		if (!lastPrint || lastPrint.kind !== "print_source") {
			throw new Error("Fixture is missing its last print evidence");
		}
		lastPrint.sourceAssetRef = oversizedRef;
		lastPrint.observedWidthPixels = 100_001;
		await assertNoPulls(
			{ manifest: dimensionsManifest, evidence: dimensionEvidence },
			/bounded positive safe integer/i,
		);
	});

	test("cross-checks observed image and ZIP facts and manifest file metadata", async () => {
		const wrongMime = evidence();
		const first = wrongMime[0];
		if (!first || first.kind !== "print_source")
			throw new Error("Fixture is missing print evidence");
		first.observedMimeType = "image/png";
		await expect(createReceiptSet({ evidence: wrongMime })).rejects.toThrow(/observed metadata/i);

		const wrongDimensions = evidence();
		const dimensionEvidence = wrongDimensions[0];
		if (!dimensionEvidence || dimensionEvidence.kind !== "print_source") {
			throw new Error("Fixture is missing print evidence");
		}
		dimensionEvidence.observedWidthPixels = 1199;
		await expect(createReceiptSet({ evidence: wrongDimensions })).rejects.toThrow(
			/observed metadata/i,
		);

		const wrongPaidSize = manifest();
		const digitalFile = wrongPaidSize.products.at(-1)?.digitalFile;
		if (!digitalFile) throw new Error("Fixture is missing its paid file");
		digitalFile.sizeBytes += 1;
		await expect(createReceiptSet({ manifest: wrongPaidSize })).rejects.toThrow(/byte count/i);

		const unsafeFilename = manifest();
		const unsafeFile = unsafeFilename.products.at(-1)?.digitalFile;
		if (!unsafeFile) throw new Error("Fixture is missing its paid file");
		unsafeFile.originalFilename = "../theme.zip";
		await expect(createReceiptSet({ manifest: unsafeFilename })).rejects.toThrow(/path/i);

		const unsafeVersion = manifest();
		const versionedFile = unsafeVersion.products.at(-1)?.digitalFile;
		if (!versionedFile) throw new Error("Fixture is missing its paid file");
		versionedFile.version = "v".repeat(65);
		await expect(createReceiptSet({ manifest: unsafeVersion })).rejects.toThrow(/version/i);
	});

	test("rejects noncanonical refs, WebP print sources, and observed or manifest MIME drift", async () => {
		const noncanonicalFile = manifest();
		const file = noncanonicalFile.products.at(-1)?.digitalFile;
		if (!file) throw new Error("Fixture is missing its paid file");
		file.sourceFileRef = "file-not-canonical-zip";
		file.sourceAssetId = "file-not-canonical-zip";
		await expect(createReceiptSet({ manifest: noncanonicalFile })).rejects.toThrow(
			/canonical Sanity file reference/i,
		);

		const webp = manifest();
		const webpPlacement = webp.products[0]?.media[0];
		if (!webpPlacement) throw new Error("Fixture is missing its first placement");
		const webpRef = `image-${"a".repeat(40)}-1200x800-webp`;
		webpPlacement.sourceAssetRef = webpRef;
		webpPlacement.sourceAssetId = webpRef;
		await expect(createReceiptSet({ manifest: webp })).rejects.toThrow(
			/canonical Sanity JPEG or PNG/i,
		);

		const observedMime = evidence();
		const paidEvidence = observedMime.at(-1);
		if (!paidEvidence || paidEvidence.kind !== "paid_digital_file") {
			throw new Error("Fixture is missing its paid evidence");
		}
		(paidEvidence as { observedMimeType: string }).observedMimeType = "application/pdf";
		await expect(createReceiptSet({ evidence: observedMime })).rejects.toThrow(/observed MIME/i);

		const manifestMime = manifest();
		const manifestFile = manifestMime.products.at(-1)?.digitalFile;
		if (!manifestFile) throw new Error("Fixture is missing its paid file");
		manifestFile.mimeType = "application/pdf";
		await expect(createReceiptSet({ manifest: manifestMime })).rejects.toThrow(/observed MIME/i);
	});

	test("bounds streaming without allocating production-sized fixtures", async () => {
		let iteratorClosed = false;
		async function* overflowStream() {
			try {
				yield encoder.encode("ab");
				yield encoder.encode("cd");
			} finally {
				iteratorClosed = true;
			}
		}
		await expect(hashCatalogPrivateAssetByteStream(overflowStream(), 3)).rejects.toThrow(
			/bounded size/i,
		);
		expect(iteratorClosed).toBe(true);
		async function* emptyChunkStream() {
			yield new Uint8Array();
			yield encoder.encode("later");
		}
		await expect(hashCatalogPrivateAssetByteStream(emptyChunkStream(), 10)).rejects.toThrow(
			/empty chunks/i,
		);
		const noBytes: AsyncIterable<Uint8Array> = {
			[Symbol.asyncIterator]() {
				return {
					async next() {
						return { done: true as const, value: undefined };
					},
				};
			},
		};
		await expect(hashCatalogPrivateAssetByteStream(noBytes, 3)).rejects.toThrow(/cannot be empty/i);
		await expect(
			hashCatalogPrivateAssetByteStream(byteStream(encoder.encode("a")), 0),
		).rejects.toThrow(/positive safe integer/i);
	});

	test("serializes no streams, source bytes, URLs, capabilities, grants, secrets, or target IDs", async () => {
		const privateMarker = "do-not-serialize-this-source-payload";
		const items = evidence({
			overrides: new Map([[PRINT_REFS[0], encoder.encode(privateMarker)]]),
		});
		Object.assign(items[0] as object, {
			uploadUrl: "https://example.invalid/private",
			capability: "upload-capability",
			grant: "download-grant",
			secret: "operator-secret",
			targetConvexId: "convex-target-id",
		});
		const serialized = JSON.stringify(await createReceiptSet({ evidence: items }));

		expect(serialized).not.toContain(privateMarker);
		expect(serialized).not.toContain("https://");
		expect(serialized).not.toContain("upload-capability");
		expect(serialized).not.toContain("download-grant");
		expect(serialized).not.toContain("operator-secret");
		expect(serialized).not.toContain("convex-target-id");
	});
});
