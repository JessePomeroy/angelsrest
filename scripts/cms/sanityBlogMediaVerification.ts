const SANITY_IMAGE_REF_PATTERN = /^image-([0-9a-f]{40})-([1-9]\d*)x([1-9]\d*)-(jpg|png|webp)$/;
const CONVEX_ID_PATTERN = /^[a-z0-9]{20,64}$/;
const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_SOURCE_BYTES = 20_000_000;

export const SANITY_BLOG_MEDIA_TRANSFER_RECEIPTS_FILENAME =
	"sanity-blog-media-transfer-receipts.json";
export const SANITY_BLOG_MEDIA_VERIFICATION_REPORT_PATH =
	"/tmp/angelsrest-sanity-blog-media-verification.json";
export const ANGELS_REST_BLOG_MEDIA_EXPECTATIONS = {
	siteUrl: "angelsrest.online",
	projectId: "n7rvza4g",
	dataset: "production",
	mediaBaseUrl: "https://media.angelsrest.online",
} as const;

export const BLOG_MEDIA_DERIVATIVES = {
	thumb: { filename: "thumb.webp", maxWidth: 320 },
	card: { filename: "card.webp", maxWidth: 768 },
	display1280: { filename: "display-1280.webp", maxWidth: 1280 },
	display2048: { filename: "display-2048.webp", maxWidth: 2048 },
	display2560: { filename: "display-2560.webp", maxWidth: 2560 },
} as const;

export type BlogMediaDerivativeName = keyof typeof BLOG_MEDIA_DERIVATIVES;
export type BlogMediaSource = {
	contentType: "image/jpeg" | "image/png" | "image/webp";
	sizeBytes: number;
	width: number;
	height: number;
};

export type SanityBlogMediaTransferReceipt = {
	mediaAssetId: string;
	workerAssetId: string;
	source: BlogMediaSource;
};

export type SanityBlogMediaTransferReceipts = {
	schemaVersion: 1;
	siteUrl: string;
	sanity: { projectId: string; dataset: string };
	receipts: Record<string, SanityBlogMediaTransferReceipt>;
};

export type ConvexImportTargetProjection = {
	mediaAssetId: string;
	workerAssetId: string;
	siteUrl: string;
	intent: string;
	status: string;
	source: BlogMediaSource;
	masterIdentityMatches: boolean;
	derivatives: Record<
		BlogMediaDerivativeName,
		{
			identityMatches: boolean;
			contentType: string;
			width: number;
			height: number;
		}
	>;
};

export type BlogMediaVerificationIssue = {
	code: string;
	message: string;
	sourceAssetRef?: string;
	mediaAssetId?: string;
	derivative?: BlogMediaDerivativeName;
};

type VerifiedDerivative = {
	identityMatches: boolean;
	contentType: string;
	width: number;
	height: number;
	probe?: { ok: boolean; status: number; contentType: string | null };
};

export type BlogMediaVerificationAsset = {
	sourceAssetRef: string;
	status: "unmapped" | "registry-verified" | "blocked";
	mediaAssetId?: string;
	workerAssetId?: string;
	source?: BlogMediaSource;
	derivatives?: Record<BlogMediaDerivativeName, VerifiedDerivative>;
};

export type SanityBlogMediaVerificationReport = {
	status: "registry-verified-partial" | "registry-verified-complete" | "blocked";
	siteUrl: string;
	sanity: { projectId: string; dataset: string; perspective: "published" };
	counts: {
		sourceAssets: number;
		mappedAssets: number;
		unmappedAssets: number;
		registryVerifiedAssets: number;
		issues: number;
	};
	issues: BlogMediaVerificationIssue[];
	assets: BlogMediaVerificationAsset[];
};

function objectValue(value: unknown, label: string): Record<string, unknown> {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} must be a JSON object`);
	}
	return value as Record<string, unknown>;
}

function requireExactKeys(
	value: Record<string, unknown>,
	expected: readonly string[],
	label: string,
) {
	const actual = Object.keys(value).sort();
	const wanted = [...expected].sort();
	if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
		throw new Error(`${label} has unexpected or missing fields`);
	}
}

function stringValue(value: unknown, label: string) {
	if (typeof value !== "string" || !value || value !== value.trim()) {
		throw new Error(`${label} must be a non-empty string without surrounding whitespace`);
	}
	return value;
}

function positiveInteger(value: unknown, label: string) {
	if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
		throw new Error(`${label} must be a positive integer`);
	}
	return value;
}

const FORBIDDEN_CONVEX_ENV_FILE_VARIABLES = new Set([
	"CONVEX_DEPLOY_KEY",
	"CONVEX_DEPLOYMENT_TOKEN",
	"CONVEX_SELF_HOSTED_URL",
	"CONVEX_SELF_HOSTED_ADMIN_KEY",
]);

export function assertSafeConvexProductionEnvFile(contents: string) {
	const variables = new Map<string, string>();
	for (const rawLine of contents.split(/\r?\n/)) {
		const line = rawLine.trim();
		if (!line || line.startsWith("#")) continue;
		if (!/^[A-Za-z_][A-Za-z0-9_]*=/.test(line)) {
			throw new Error("Convex environment requires canonical NAME=value assignments");
		}
		const equalsIndex = line.indexOf("=");
		const name = line.slice(0, equalsIndex).trim();
		const rawValue = line.slice(equalsIndex + 1).trim();
		const inlineCommentIndex = rawValue.search(/\s#/);
		const withoutComment =
			inlineCommentIndex === -1 ? rawValue : rawValue.slice(0, inlineCommentIndex).trim();
		const value = withoutComment.replace(/^['"]|['"]$/g, "");
		if (variables.has(name)) throw new Error(`Convex environment repeats ${name}`);
		variables.set(name, value);
	}
	for (const name of FORBIDDEN_CONVEX_ENV_FILE_VARIABLES) {
		if (variables.has(name)) {
			throw new Error(`Convex production verification forbids ${name}`);
		}
	}
	const deployment = variables.get("CONVEX_DEPLOYMENT");
	if (!deployment || !/^(?:dev|prod):[a-z0-9-]+$/.test(deployment)) {
		throw new Error("Convex production verification requires one cloud CONVEX_DEPLOYMENT");
	}
}

export function sanitizedConvexCliEnvironment(
	environment: Readonly<Record<string, string | undefined>>,
) {
	return Object.fromEntries(
		Object.entries(environment).filter(
			(entry): entry is [string, string] =>
				entry[1] !== undefined && !entry[0].startsWith("CONVEX_"),
		),
	);
}

function contentType(value: unknown, label: string): BlogMediaSource["contentType"] {
	if (value !== "image/jpeg" && value !== "image/png" && value !== "image/webp") {
		throw new Error(`${label} must be image/jpeg, image/png, or image/webp`);
	}
	return value;
}

function parseSource(value: unknown, label: string): BlogMediaSource {
	const source = objectValue(value, label);
	requireExactKeys(source, ["contentType", "sizeBytes", "width", "height"], label);
	const sizeBytes = positiveInteger(source.sizeBytes, `${label}.sizeBytes`);
	if (sizeBytes > MAX_SOURCE_BYTES) throw new Error(`${label}.sizeBytes exceeds 20000000`);
	return {
		contentType: contentType(source.contentType, `${label}.contentType`),
		sizeBytes,
		width: positiveInteger(source.width, `${label}.width`),
		height: positiveInteger(source.height, `${label}.height`),
	};
}

export function parseStrictSanityImageAssetRef(sourceAssetRef: string) {
	const match = SANITY_IMAGE_REF_PATTERN.exec(sourceAssetRef);
	if (!match) throw new Error(`Invalid canonical Sanity image asset reference: ${sourceAssetRef}`);
	const [, , width, height, extension] = match;
	return {
		sourceAssetRef,
		width: Number(width),
		height: Number(height),
		contentType: (extension === "jpg" ? "image/jpeg" : `image/${extension}`) as
			| "image/jpeg"
			| "image/png"
			| "image/webp",
	};
}

export function parseSanityBlogImageAssetJournal(value: unknown) {
	const input = objectValue(value, "Sanity Blog image asset journal");
	const entries = Object.entries(input).map(([sourceAssetRef, targetAssetId]) => {
		parseStrictSanityImageAssetRef(sourceAssetRef);
		if (typeof targetAssetId !== "string" || targetAssetId !== targetAssetId.trim()) {
			throw new Error(`Journal target for ${sourceAssetRef} must be a trimmed string`);
		}
		if (targetAssetId && !CONVEX_ID_PATTERN.test(targetAssetId)) {
			throw new Error(`Journal target for ${sourceAssetRef} is not a canonical Convex ID`);
		}
		return [sourceAssetRef, targetAssetId] as const;
	});
	entries.sort(([left], [right]) => left.localeCompare(right));
	return Object.fromEntries(entries) as Record<string, string>;
}

export function parseSanityBlogMediaTransferReceipts(
	value: unknown,
): SanityBlogMediaTransferReceipts {
	const root = objectValue(value, "Sanity Blog media transfer receipts");
	requireExactKeys(root, ["schemaVersion", "siteUrl", "sanity", "receipts"], "receipts root");
	if (root.schemaVersion !== 1) throw new Error("Unsupported transfer receipt schemaVersion");
	const sanity = objectValue(root.sanity, "receipts.sanity");
	requireExactKeys(sanity, ["projectId", "dataset"], "receipts.sanity");
	const receiptValues = objectValue(root.receipts, "receipts.receipts");
	const receipts: Record<string, SanityBlogMediaTransferReceipt> = {};
	const mediaAssetIds = new Set<string>();
	const workerAssetIds = new Set<string>();

	for (const [sourceAssetRef, rawReceipt] of Object.entries(receiptValues).sort(([a], [b]) =>
		a.localeCompare(b),
	)) {
		const sourceRef = parseStrictSanityImageAssetRef(sourceAssetRef);
		const receipt = objectValue(rawReceipt, `receipt ${sourceAssetRef}`);
		requireExactKeys(
			receipt,
			["mediaAssetId", "workerAssetId", "source"],
			`receipt ${sourceAssetRef}`,
		);
		const mediaAssetId = stringValue(receipt.mediaAssetId, "receipt.mediaAssetId");
		if (!CONVEX_ID_PATTERN.test(mediaAssetId)) throw new Error("Receipt has invalid Convex ID");
		const workerAssetId = stringValue(receipt.workerAssetId, "receipt.workerAssetId");
		if (!UUID_V4_PATTERN.test(workerAssetId)) throw new Error("Receipt has invalid Worker UUID v4");
		if (mediaAssetIds.has(mediaAssetId)) throw new Error("Transfer receipts duplicate a Convex ID");
		if (workerAssetIds.has(workerAssetId))
			throw new Error("Transfer receipts duplicate a Worker UUID");
		mediaAssetIds.add(mediaAssetId);
		workerAssetIds.add(workerAssetId);
		const source = parseSource(receipt.source, `receipt ${sourceAssetRef}.source`);
		if (
			source.contentType !== sourceRef.contentType ||
			source.width !== sourceRef.width ||
			source.height !== sourceRef.height
		)
			throw new Error(`Receipt source metadata does not match ${sourceAssetRef}`);
		receipts[sourceAssetRef] = { mediaAssetId, workerAssetId, source };
	}

	return {
		schemaVersion: 1,
		siteUrl: stringValue(root.siteUrl, "receipts.siteUrl"),
		sanity: {
			projectId: stringValue(sanity.projectId, "receipts.sanity.projectId"),
			dataset: stringValue(sanity.dataset, "receipts.sanity.dataset"),
		},
		receipts,
	};
}

function sourceRefFromImage(value: unknown) {
	if (typeof value !== "object" || value === null || !("asset" in value)) return null;
	const asset = (value as { asset?: unknown }).asset;
	if (typeof asset !== "object" || asset === null || !("_ref" in asset)) return null;
	const ref = (asset as { _ref?: unknown })._ref;
	if (typeof ref !== "string") return null;
	parseStrictSanityImageAssetRef(ref);
	return ref;
}

export function collectPublishedSanityBlogImageAssetRefs(value: unknown) {
	const source = objectValue(value, "published Sanity Blog source");
	const refs = new Set<string>();
	for (const author of Array.isArray(source.authors) ? source.authors : []) {
		if (typeof author !== "object" || author === null) continue;
		const ref = sourceRefFromImage((author as { image?: unknown }).image);
		if (ref) refs.add(ref);
	}
	for (const post of Array.isArray(source.posts) ? source.posts : []) {
		if (typeof post !== "object" || post === null) continue;
		const typedPost = post as { mainImage?: unknown; body?: unknown };
		const mainRef = sourceRefFromImage(typedPost.mainImage);
		if (mainRef) refs.add(mainRef);
		for (const node of Array.isArray(typedPost.body) ? typedPost.body : []) {
			if (typeof node !== "object" || node === null || !("_type" in node)) continue;
			if ((node as { _type?: unknown })._type !== "image") continue;
			const ref = sourceRefFromImage(node);
			if (ref) refs.add(ref);
		}
	}
	return [...refs].sort((left, right) => left.localeCompare(right));
}

function parseDerivative(value: unknown, label: string) {
	const derivative = objectValue(value, label);
	requireExactKeys(derivative, ["identityMatches", "contentType", "width", "height"], label);
	if (typeof derivative.identityMatches !== "boolean") {
		throw new Error(`${label}.identityMatches must be boolean`);
	}
	return {
		identityMatches: derivative.identityMatches,
		contentType: stringValue(derivative.contentType, `${label}.contentType`),
		width: positiveInteger(derivative.width, `${label}.width`),
		height: positiveInteger(derivative.height, `${label}.height`),
	};
}

export function parseConvexImportTargetProjections(value: unknown): ConvexImportTargetProjection[] {
	if (!Array.isArray(value)) throw new Error("Convex import target result must be an array");
	return value.map((rawRow, index) => {
		const row = objectValue(rawRow, `Convex import target ${index}`);
		requireExactKeys(
			row,
			[
				"mediaAssetId",
				"workerAssetId",
				"siteUrl",
				"intent",
				"status",
				"source",
				"masterIdentityMatches",
				"derivatives",
			],
			`Convex import target ${index}`,
		);
		const derivatives = objectValue(row.derivatives, `target ${index}.derivatives`);
		requireExactKeys(
			derivatives,
			Object.keys(BLOG_MEDIA_DERIVATIVES),
			`target ${index}.derivatives`,
		);
		if (typeof row.masterIdentityMatches !== "boolean") {
			throw new Error(`target ${index}.masterIdentityMatches must be boolean`);
		}
		return {
			mediaAssetId: stringValue(row.mediaAssetId, `target ${index}.mediaAssetId`),
			workerAssetId: stringValue(row.workerAssetId, `target ${index}.workerAssetId`),
			siteUrl: stringValue(row.siteUrl, `target ${index}.siteUrl`),
			intent: stringValue(row.intent, `target ${index}.intent`),
			status: stringValue(row.status, `target ${index}.status`),
			source: parseSource(row.source, `target ${index}.source`),
			masterIdentityMatches: row.masterIdentityMatches,
			derivatives: Object.fromEntries(
				(Object.keys(BLOG_MEDIA_DERIVATIVES) as BlogMediaDerivativeName[]).map((name) => [
					name,
					parseDerivative(derivatives[name], `target ${index}.derivatives.${name}`),
				]),
			) as ConvexImportTargetProjection["derivatives"],
		};
	});
}

function sameSource(left: BlogMediaSource, right: BlogMediaSource) {
	return (
		left.contentType === right.contentType &&
		left.sizeBytes === right.sizeBytes &&
		left.width === right.width &&
		left.height === right.height
	);
}

function scaledDimensions(width: number, height: number, maxWidth: number) {
	const outputWidth = Math.min(width, maxWidth);
	return { width: outputWidth, height: Math.max(1, Math.round(height * (outputWidth / width))) };
}

export function verifySanityBlogMediaTargets({
	sourceAssetRefs,
	journal,
	receiptFile,
	convexTargets,
	expected = ANGELS_REST_BLOG_MEDIA_EXPECTATIONS,
}: {
	sourceAssetRefs: readonly string[];
	journal: Readonly<Record<string, string>>;
	receiptFile: SanityBlogMediaTransferReceipts;
	convexTargets: readonly ConvexImportTargetProjection[];
	expected?: { siteUrl: string; projectId: string; dataset: string };
}): SanityBlogMediaVerificationReport {
	const issues: BlogMediaVerificationIssue[] = [];
	const addIssue = (issue: BlogMediaVerificationIssue) => issues.push(issue);
	const canonicalSourceRefs = [...new Set(sourceAssetRefs)].sort((a, b) => a.localeCompare(b));
	for (const ref of canonicalSourceRefs) parseStrictSanityImageAssetRef(ref);
	const sourceSet = new Set(canonicalSourceRefs);
	const journalRefs = Object.keys(journal).sort((a, b) => a.localeCompare(b));
	for (const ref of canonicalSourceRefs) {
		if (!(ref in journal))
			addIssue({
				code: "journal-missing-source",
				message: "Published source is missing from the journal",
				sourceAssetRef: ref,
			});
	}
	for (const ref of journalRefs) {
		if (!sourceSet.has(ref))
			addIssue({
				code: "journal-stale-source",
				message: "Journal entry is absent from the published source",
				sourceAssetRef: ref,
			});
	}
	if (receiptFile.siteUrl !== expected.siteUrl)
		addIssue({
			code: "receipt-site-drift",
			message: "Receipt site does not match the expected tenant",
		});
	if (
		receiptFile.sanity.projectId !== expected.projectId ||
		receiptFile.sanity.dataset !== expected.dataset
	)
		addIssue({
			code: "receipt-source-drift",
			message: "Receipt Sanity source does not match the expected published dataset",
		});

	const mappedIds = new Map<string, string>();
	for (const [ref, id] of Object.entries(journal)) {
		if (!id) continue;
		const duplicateRef = mappedIds.get(id);
		if (duplicateRef)
			addIssue({
				code: "journal-duplicate-target",
				message: `Journal target is also used by ${duplicateRef}`,
				sourceAssetRef: ref,
				mediaAssetId: id,
			});
		else mappedIds.set(id, ref);
		if (!receiptFile.receipts[ref])
			addIssue({
				code: "receipt-missing",
				message: "Populated journal entry has no transfer receipt",
				sourceAssetRef: ref,
				mediaAssetId: id,
			});
	}
	for (const [ref, receipt] of Object.entries(receiptFile.receipts)) {
		if (!sourceSet.has(ref) || !(ref in journal))
			addIssue({
				code: "receipt-stale-source",
				message: "Transfer receipt is absent from the published source or journal",
				sourceAssetRef: ref,
				mediaAssetId: receipt.mediaAssetId,
			});
		else if (!journal[ref])
			addIssue({
				code: "receipt-for-unmapped-source",
				message: "Transfer receipt exists for a blank journal entry",
				sourceAssetRef: ref,
				mediaAssetId: receipt.mediaAssetId,
			});
		else if (journal[ref] !== receipt.mediaAssetId)
			addIssue({
				code: "receipt-target-drift",
				message: "Receipt Convex ID does not match the journal",
				sourceAssetRef: ref,
				mediaAssetId: receipt.mediaAssetId,
			});
	}

	const targetById = new Map<string, ConvexImportTargetProjection>();
	for (const target of convexTargets) {
		if (targetById.has(target.mediaAssetId))
			addIssue({
				code: "convex-duplicate-target",
				message: "Convex verification returned a duplicate target",
				mediaAssetId: target.mediaAssetId,
			});
		else targetById.set(target.mediaAssetId, target);
		if (!mappedIds.has(target.mediaAssetId))
			addIssue({
				code: "convex-unrequested-target",
				message: "Convex verification returned an unrequested target",
				mediaAssetId: target.mediaAssetId,
			});
	}

	const assets: BlogMediaVerificationAsset[] = canonicalSourceRefs.map((sourceAssetRef) => {
		const mediaAssetId = journal[sourceAssetRef] ?? "";
		if (!mediaAssetId) return { sourceAssetRef, status: "unmapped" };
		const receipt = receiptFile.receipts[sourceAssetRef];
		const target = targetById.get(mediaAssetId);
		if (!target) {
			addIssue({
				code: "convex-target-missing",
				message: "Convex verification did not return the mapped target",
				sourceAssetRef,
				mediaAssetId,
			});
			return { sourceAssetRef, status: "blocked", mediaAssetId };
		}
		const hadAssetIssue = issues.some(
			(issue) => issue.sourceAssetRef === sourceAssetRef || issue.mediaAssetId === mediaAssetId,
		);
		const issueCount = issues.length;
		if (!receipt) return { sourceAssetRef, status: "blocked", mediaAssetId };
		if (target.siteUrl !== expected.siteUrl)
			addIssue({
				code: "convex-site-mismatch",
				message: "Convex target belongs to a different tenant",
				sourceAssetRef,
				mediaAssetId,
			});
		if (target.intent !== "web")
			addIssue({
				code: "convex-intent-mismatch",
				message: "Convex target intent is not web",
				sourceAssetRef,
				mediaAssetId,
			});
		if (target.status !== "ready")
			addIssue({
				code: "convex-status-mismatch",
				message: "Convex target is not ready",
				sourceAssetRef,
				mediaAssetId,
			});
		if (target.workerAssetId !== receipt.workerAssetId)
			addIssue({
				code: "worker-identity-mismatch",
				message: "Convex and receipt Worker identities differ",
				sourceAssetRef,
				mediaAssetId,
			});
		if (!UUID_V4_PATTERN.test(target.workerAssetId))
			addIssue({
				code: "worker-identity-invalid",
				message: "Convex target Worker identity is not a canonical UUID v4",
				sourceAssetRef,
				mediaAssetId,
			});
		if (!sameSource(target.source, receipt.source))
			addIssue({
				code: "source-metadata-mismatch",
				message: "Convex and receipt source metadata differ",
				sourceAssetRef,
				mediaAssetId,
			});
		if (!target.masterIdentityMatches)
			addIssue({
				code: "master-identity-mismatch",
				message: "Private master identity does not match the tenant asset identity",
				sourceAssetRef,
				mediaAssetId,
			});
		for (const [name, spec] of Object.entries(BLOG_MEDIA_DERIVATIVES) as Array<
			[BlogMediaDerivativeName, (typeof BLOG_MEDIA_DERIVATIVES)[BlogMediaDerivativeName]]
		>) {
			const derivative = target.derivatives[name];
			const expectedDimensions = scaledDimensions(
				target.source.width,
				target.source.height,
				spec.maxWidth,
			);
			if (!derivative.identityMatches)
				addIssue({
					code: "derivative-identity-mismatch",
					message: "Derivative identity does not match the tenant asset identity",
					sourceAssetRef,
					mediaAssetId,
					derivative: name,
				});
			if (derivative.contentType !== "image/webp")
				addIssue({
					code: "derivative-content-type-mismatch",
					message: "Derivative content type is not image/webp",
					sourceAssetRef,
					mediaAssetId,
					derivative: name,
				});
			if (
				derivative.width !== expectedDimensions.width ||
				derivative.height !== expectedDimensions.height
			)
				addIssue({
					code: "derivative-dimensions-mismatch",
					message: "Derivative dimensions do not match the source preset",
					sourceAssetRef,
					mediaAssetId,
					derivative: name,
				});
		}
		return {
			sourceAssetRef,
			status: !hadAssetIssue && issues.length === issueCount ? "registry-verified" : "blocked",
			mediaAssetId,
			workerAssetId: target.workerAssetId,
			source: target.source,
			derivatives: target.derivatives,
		};
	});

	const mappedAssets = canonicalSourceRefs.filter((ref) => Boolean(journal[ref])).length;
	const registryVerifiedAssets = assets.filter(
		(asset) => asset.status === "registry-verified",
	).length;
	return {
		status:
			issues.length > 0
				? "blocked"
				: mappedAssets === canonicalSourceRefs.length
					? "registry-verified-complete"
					: "registry-verified-partial",
		siteUrl: expected.siteUrl,
		sanity: { projectId: expected.projectId, dataset: expected.dataset, perspective: "published" },
		counts: {
			sourceAssets: canonicalSourceRefs.length,
			mappedAssets,
			unmappedAssets: canonicalSourceRefs.length - mappedAssets,
			registryVerifiedAssets,
			issues: issues.length,
		},
		issues,
		assets,
	};
}

function derivativeUrl(
	mediaBaseUrl: string,
	siteUrl: string,
	workerAssetId: string,
	filename: string,
) {
	const base = new URL(mediaBaseUrl);
	if (base.protocol !== "https:" || base.username || base.password || base.search || base.hash) {
		throw new Error("Media base URL must be an HTTPS URL without credentials, query, or fragment");
	}
	const prefix = base.toString().replace(/\/+$/, "");
	const path = ["sites", siteUrl, "web", workerAssetId, filename].map(encodeURIComponent).join("/");
	return `${prefix}/${path}`;
}

export async function probeSanityBlogMediaDerivatives(
	report: SanityBlogMediaVerificationReport,
	{ fetcher, mediaBaseUrl }: { fetcher: typeof fetch; mediaBaseUrl: string },
) {
	if (report.status === "blocked") return report;
	const issues = [...report.issues];
	const assets: BlogMediaVerificationAsset[] = [];
	for (const asset of report.assets) {
		if (asset.status !== "registry-verified" || !asset.workerAssetId || !asset.derivatives) {
			assets.push(asset);
			continue;
		}
		const derivatives = { ...asset.derivatives };
		let blocked = false;
		for (const [name, spec] of Object.entries(BLOG_MEDIA_DERIVATIVES) as Array<
			[BlogMediaDerivativeName, (typeof BLOG_MEDIA_DERIVATIVES)[BlogMediaDerivativeName]]
		>) {
			let probe = { ok: false, status: 0, contentType: null as string | null };
			try {
				const response = await fetcher(
					derivativeUrl(mediaBaseUrl, report.siteUrl, asset.workerAssetId, spec.filename),
					{ method: "HEAD", redirect: "error" },
				);
				const responseContentType = response.headers.get("content-type")?.split(";", 1)[0] ?? null;
				probe = {
					ok: response.ok && responseContentType === "image/webp",
					status: response.status,
					contentType: responseContentType,
				};
			} catch {
				probe = { ok: false, status: 0, contentType: null };
			}
			derivatives[name] = { ...derivatives[name], probe };
			if (!probe.ok) {
				blocked = true;
				issues.push({
					code: "derivative-probe-failed",
					message: "Public derivative HEAD probe did not return image/webp",
					sourceAssetRef: asset.sourceAssetRef,
					mediaAssetId: asset.mediaAssetId,
					derivative: name,
				});
			}
		}
		assets.push({
			...asset,
			status: blocked ? "blocked" : "registry-verified",
			derivatives,
		});
	}
	const registryVerifiedAssets = assets.filter(
		(asset) => asset.status === "registry-verified",
	).length;
	return {
		...report,
		status: issues.length > 0 ? ("blocked" as const) : report.status,
		counts: { ...report.counts, registryVerifiedAssets, issues: issues.length },
		issues,
		assets,
	};
}
