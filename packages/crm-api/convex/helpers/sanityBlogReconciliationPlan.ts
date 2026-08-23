import type { Infer } from "convex/values";
import { v } from "convex/values";
import type { Id } from "../_generated/dataModel";
import {
	blogSupportingDraftValidator,
	type BlogSupportingDraft,
	toPublishedBlogSupportingContent,
} from "./blogContentValidators";
import { validateBlogDocumentKey } from "./blogContentData";
import {
	createSanityBlogImportDryRunReport,
	createSanityBlogImportManifest,
	type SanityBlogImportManifest,
	type SanityBlogImportSource,
} from "./sanityBlogImport";
import type { SanityBlogImportReleaseContract } from "./sanityBlogImportPlan";
import { validatePostDocumentKey } from "./postContentGraph";
import {
	postDraftValidator,
	type PostDraft,
	toPublishedPostDraft,
} from "./postContentValidators";

const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const REVISION_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;
const STABLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const SANITY_IMAGE_REF_PATTERN = /^image-[A-Za-z0-9]+-\d+x\d+-[A-Za-z0-9]+$/;

const sourceIdentityValidator = v.object({
	projectId: v.string(),
	dataset: v.string(),
	perspective: v.literal("published"),
});

const predecessorValidator = v.object({
	version: v.literal(1),
	migrationId: v.string(),
	siteUrl: v.string(),
	expectedDigest: v.string(),
	source: sourceIdentityValidator,
});

const assetMappingValidator = v.object({
	sourceAssetRef: v.string(),
	mediaAssetId: v.id("mediaAssets"),
});

const targetBaselineValidator = v.object({
	documentId: v.id("contentDocuments"),
	draftRevisionId: v.id("contentRevisions"),
	draftChecksum: v.string(),
	documentSlug: v.optional(v.string()),
	rank: v.number(),
});

const categorySlugDecisionValidator = v.object({
	sourceId: v.string(),
	slug: v.string(),
});

const postSummaryDecisionValidator = v.object({
	sourceId: v.string(),
	summary: v.string(),
});

const cropValidator = v.object({
	top: v.number(),
	bottom: v.number(),
	left: v.number(),
	right: v.number(),
});

const hotspotValidator = v.object({
	x: v.number(),
	y: v.number(),
	width: v.number(),
	height: v.number(),
});

const imagePlacementDecisionValidator = v.object({
	placementId: v.string(),
	sourceDocumentId: v.string(),
	sourceRevision: v.string(),
	sourcePath: v.string(),
	sourceAssetRef: v.string(),
	sourceAltText: v.optional(v.string()),
	sourceCaption: v.optional(v.string()),
	sourceCrop: v.optional(cropValidator),
	sourceHotspot: v.optional(hotspotValidator),
	targetDocumentKey: v.string(),
	targetPlacementKey: v.string(),
	targetRole: v.union(v.literal("portrait"), v.literal("main"), v.literal("body")),
	targetOrder: v.number(),
	mediaAssetId: v.id("mediaAssets"),
	altAction: v.union(v.literal("accept-source"), v.literal("owner-replacement")),
	altText: v.string(),
	captionAction: v.union(
		v.literal("confirmed-absent"),
		v.literal("accept-source"),
		v.literal("owner-replacement"),
	),
	caption: v.optional(v.string()),
	cropHotspotAction: v.union(
		v.literal("confirmed-absent"),
		v.literal("omit-owner-approved"),
	),
});

const gearSourceValidator = v.object({
	camera: v.optional(v.string()),
	lens: v.optional(v.string()),
	filmStock: v.optional(v.string()),
	developer: v.optional(v.string()),
});

const gearDecisionValidator = v.object({
	gearId: v.string(),
	sourcePostId: v.string(),
	sourceRevision: v.string(),
	sourcePath: v.string(),
	sourceKey: v.string(),
	sourceOrder: v.number(),
	source: gearSourceValidator,
	action: v.literal("collapse-to-equipment-owner-approved"),
	targetKey: v.string(),
	targetLabel: v.optional(v.string()),
	targetDetails: v.optional(v.string()),
});

const unsupportedFieldDecisionValidator = v.object({
	sourceDocumentId: v.string(),
	sourcePath: v.string(),
	sourceValueCanonical: v.string(),
	action: v.literal("omit-owner-approved"),
});

const absentTargetFieldDecisionValidator = v.object({
	field: v.union(
		v.literal("credits"),
		v.literal("materials"),
		v.literal("seoDescription"),
		v.literal("seoTitle"),
	),
	action: v.literal("keep-absent-owner-approved"),
});

const decisionSetValidator = v.object({
	id: v.string(),
	categorySlugs: v.array(categorySlugDecisionValidator),
	postSummaries: v.array(postSummaryDecisionValidator),
	imagePlacements: v.array(imagePlacementDecisionValidator),
	gearMappings: v.array(gearDecisionValidator),
	unsupportedFields: v.array(unsupportedFieldDecisionValidator),
	absentTargetFields: v.array(absentTargetFieldDecisionValidator),
});

const supportingDocumentValidator = v.object({
	sourceId: v.string(),
	sourceRevision: v.string(),
	documentKey: v.string(),
	target: targetBaselineValidator,
	draft: blogSupportingDraftValidator,
});

const categoryReferenceValidator = v.object({
	key: v.string(),
	documentKey: v.string(),
});

const postDocumentValidator = v.object({
	sourceId: v.string(),
	sourceRevision: v.string(),
	documentKey: v.string(),
	authorDocumentKey: v.string(),
	categoryReferences: v.array(categoryReferenceValidator),
	target: targetBaselineValidator,
	draft: postDraftValidator,
});

/** Additive v2. The accepted v1 validator, bytes, path, and digest are unchanged. */
export const sanityBlogReconciliationPlanValidator = v.object({
	version: v.literal(2),
	migrationId: v.string(),
	siteUrl: v.string(),
	source: sourceIdentityValidator,
	predecessor: predecessorValidator,
	decisionSet: decisionSetValidator,
	assetMappings: v.array(assetMappingValidator),
	authors: v.array(supportingDocumentValidator),
	categories: v.array(supportingDocumentValidator),
	posts: v.array(postDocumentValidator),
});

export type SanityBlogReconciliationPlan = Infer<
	typeof sanityBlogReconciliationPlanValidator
>;

export type SanityBlogTargetBaseline = Infer<typeof targetBaselineValidator>;

type RevisionPinned<T> = T & { _rev?: unknown };

/** Additive v2 source shape. The accepted v1 import source remains unchanged. */
export type SanityBlogReconciliationSource = {
	authors: Array<RevisionPinned<SanityBlogImportSource["authors"][number]>>;
	categories: Array<RevisionPinned<SanityBlogImportSource["categories"][number]>>;
	posts: Array<RevisionPinned<SanityBlogImportSource["posts"][number]>>;
};

type ImagePlacementInput = {
	altAction: "accept-source" | "owner-replacement";
	altText: string;
	captionAction: "confirmed-absent" | "accept-source" | "owner-replacement";
	caption?: string;
	cropHotspotAction: "confirmed-absent" | "omit-owner-approved";
};

type GearMappingInput = {
	action: "collapse-to-equipment-owner-approved";
	targetKey: string;
	targetLabel?: string;
	targetDetails?: string;
};

export type SanityBlogOwnerDecisions = {
	id: string;
	categorySlugs: Readonly<Record<string, string>>;
	postSummaries: Readonly<Record<string, string>>;
	imagePlacements: Readonly<Record<string, ImagePlacementInput>>;
	gearMappings: Readonly<Record<string, GearMappingInput>>;
	unsupportedFields: ReadonlyArray<Infer<typeof unsupportedFieldDecisionValidator>>;
	absentTargetFields: ReadonlyArray<Infer<typeof absentTargetFieldDecisionValidator>>;
};

export type SanityBlogReconciliationBuildOptions = {
	migrationId: string;
	siteUrl: string;
	source: SanityBlogReconciliationPlan["source"];
	predecessor: SanityBlogImportReleaseContract;
	imageAssetIds: Readonly<Record<string, string>>;
	targets: Readonly<Record<string, SanityBlogTargetBaseline>>;
	decisions: SanityBlogOwnerDecisions;
};

type JsonRecord = Record<string, unknown>;

type SourceImagePlacement = {
	placementId: string;
	sourceDocumentId: string;
	sourceRevision: string;
	sourcePath: string;
	sourceAssetRef: string;
	sourceAltText?: string;
	sourceCaption?: string;
	sourceCrop?: Infer<typeof cropValidator>;
	sourceHotspot?: Infer<typeof hotspotValidator>;
	targetDocumentKey: string;
	targetPlacementKey: string;
	targetRole: "portrait" | "main" | "body";
	targetOrder: number;
};

type SourceGear = {
	gearId: string;
	sourcePostId: string;
	sourceRevision: string;
	sourcePath: string;
	sourceKey: string;
	sourceOrder: number;
	source: Infer<typeof gearSourceValidator>;
};

function compareOrdinal(left: string, right: string) {
	return left < right ? -1 : left > right ? 1 : 0;
}

function sorted(values: readonly string[]) {
	return [...values].sort(compareOrdinal);
}

function assertExactStrings(
	actual: readonly string[],
	expected: readonly string[],
	label: string,
) {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(`${label} must cover the exact accepted set`);
	}
}

function assertUnique(values: readonly string[], label: string) {
	if (new Set(values).size !== values.length) throw new Error(`${label} must be unique`);
}

function requireStableId(value: string, label: string) {
	if (!STABLE_ID_PATTERN.test(value)) throw new Error(`${label} is invalid`);
	return value;
}

function requireRevision(value: unknown, label: string) {
	if (typeof value !== "string" || !REVISION_PATTERN.test(value)) {
		throw new Error(`${label} must include an exact Sanity _rev`);
	}
	return value;
}

function requireDigest(value: string, label: string) {
	if (!SHA256_PATTERN.test(value)) throw new Error(`${label} must be a lowercase SHA-256`);
	return value;
}

function cleanSourceId(value: string) {
	return value.replace(/^drafts\./, "");
}

function asRecord(value: unknown, label: string): JsonRecord {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error(`${label} is invalid`);
	}
	return value as JsonRecord;
}

function optionalText(value: unknown, label: string) {
	if (value === undefined || value === null || value === "") return undefined;
	if (typeof value !== "string" || value !== value.trim()) {
		throw new Error(`${label} must be trimmed text`);
	}
	return value;
}

function requiredText(value: unknown, label: string) {
	const normalized = optionalText(value, label);
	if (!normalized) throw new Error(`${label} is required`);
	return normalized;
}

function sourceReference(value: unknown, label: string) {
	const reference = asRecord(value, label);
	const sourceRef = requiredText(reference._ref, `${label}._ref`);
	return cleanSourceId(sourceRef);
}

function sourceImageRef(value: JsonRecord, label: string) {
	const sourceRef = sourceReference(value.asset, `${label}.asset`);
	if (!SANITY_IMAGE_REF_PATTERN.test(sourceRef)) {
		throw new Error(`${label} has an invalid Sanity image reference`);
	}
	return sourceRef;
}

function finiteUnit(value: unknown, label: string) {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) {
		throw new Error(`${label} must be a finite unit value`);
	}
	return value;
}

function sourceCrop(value: unknown, label: string) {
	if (value === undefined || value === null) return undefined;
	const crop = asRecord(value, label);
	const keys = ["bottom", "left", "right", "top", ...(crop._type === undefined ? [] : ["_type"])]
		.sort(compareOrdinal);
	assertExactStrings(sorted(Object.keys(crop)), keys, label);
	if (crop._type !== undefined && crop._type !== "sanity.imageCrop") {
		throw new Error(`${label} has an invalid Sanity type`);
	}
	return {
		top: finiteUnit(crop.top, `${label}.top`),
		bottom: finiteUnit(crop.bottom, `${label}.bottom`),
		left: finiteUnit(crop.left, `${label}.left`),
		right: finiteUnit(crop.right, `${label}.right`),
	};
}

function sourceHotspot(value: unknown, label: string) {
	if (value === undefined || value === null) return undefined;
	const hotspot = asRecord(value, label);
	const keys = ["height", "width", "x", "y", ...(hotspot._type === undefined ? [] : ["_type"])]
		.sort(compareOrdinal);
	assertExactStrings(sorted(Object.keys(hotspot)), keys, label);
	if (hotspot._type !== undefined && hotspot._type !== "sanity.imageHotspot") {
		throw new Error(`${label} has an invalid Sanity type`);
	}
	return {
		x: finiteUnit(hotspot.x, `${label}.x`),
		y: finiteUnit(hotspot.y, `${label}.y`),
		width: finiteUnit(hotspot.width, `${label}.width`),
		height: finiteUnit(hotspot.height, `${label}.height`),
	};
}

function imagePlacement(
	image: unknown,
	base: Omit<
		SourceImagePlacement,
		| "sourceAssetRef"
		| "sourceAltText"
		| "sourceCaption"
		| "sourceCrop"
		| "sourceHotspot"
	>,
): SourceImagePlacement {
	const source = asRecord(image, base.sourcePath);
	const altText = optionalText(source.alt, `${base.sourcePath}.alt`);
	const caption = optionalText(source.caption, `${base.sourcePath}.caption`);
	const crop = sourceCrop(source.crop, `${base.sourcePath}.crop`);
	const hotspot = sourceHotspot(source.hotspot, `${base.sourcePath}.hotspot`);
	return {
		...base,
		sourceAssetRef: sourceImageRef(source, base.sourcePath),
		...(altText ? { sourceAltText: altText } : {}),
		...(caption ? { sourceCaption: caption } : {}),
		...(crop ? { sourceCrop: crop } : {}),
		...(hotspot ? { sourceHotspot: hotspot } : {}),
	};
}

function sourceRevisions(
	values: ReadonlyArray<{ _id: string; _rev?: unknown }>,
	kind: "author" | "category" | "post",
) {
	const entries = values.map((value) => {
		const sourceId = cleanSourceId(requiredText(value._id, `${kind} source ID`));
		return [sourceId, requireRevision(value._rev, `${kind} ${sourceId}`)] as const;
	});
	assertUnique(entries.map(([sourceId]) => sourceId), `${kind} source IDs`);
	return new Map(entries);
}

function collectImagePlacements(
	source: SanityBlogReconciliationSource,
	revisions: {
		authors: ReadonlyMap<string, string>;
		posts: ReadonlyMap<string, string>;
	},
) {
	const placements: SourceImagePlacement[] = [];
	for (const authorValue of source.authors) {
		const author = authorValue as typeof authorValue & JsonRecord;
		const sourceId = cleanSourceId(author._id);
		const sourceRevision = requireRevision(revisions.authors.get(sourceId), `author ${sourceId}`);
		if (author.image === undefined || author.image === null) continue;
		const image = asRecord(author.image, `author ${sourceId} image`);
		const key = optionalText(image._key, `author ${sourceId} image key`) ?? "portrait";
		placements.push(
			imagePlacement(image, {
				placementId: `author:${sourceId}:portrait`,
				sourceDocumentId: sourceId,
				sourceRevision,
				sourcePath: `authors.${sourceId}.image`,
				targetDocumentKey: `sanity.author.${sourceId}`,
				targetPlacementKey: key,
				targetRole: "portrait",
				targetOrder: 0,
			}),
		);
	}
	for (const postValue of source.posts) {
		const post = postValue as typeof postValue & JsonRecord;
		const sourceId = cleanSourceId(post._id);
		const sourceRevision = requireRevision(revisions.posts.get(sourceId), `post ${sourceId}`);
		if (post.mainImage !== undefined && post.mainImage !== null) {
			const image = asRecord(post.mainImage, `post ${sourceId} main image`);
			const key = optionalText(image._key, `post ${sourceId} main image key`) ?? "main-image";
			placements.push(
				imagePlacement(image, {
					placementId: `post:${sourceId}:main`,
					sourceDocumentId: sourceId,
					sourceRevision,
					sourcePath: `posts.${sourceId}.mainImage`,
					targetDocumentKey: `sanity.post.${sourceId}`,
					targetPlacementKey: key,
					targetRole: "main",
					targetOrder: 0,
				}),
			);
		}
		if (!Array.isArray(post.body)) continue;
		let imageOrder = 0;
		for (const nodeValue of post.body) {
			if (typeof nodeValue !== "object" || nodeValue === null || Array.isArray(nodeValue)) continue;
			const node = nodeValue as JsonRecord;
			if (node._type !== "image") continue;
			const key = requiredText(node._key, `post ${sourceId} body image key`);
			placements.push(
				imagePlacement(node, {
					placementId: `post:${sourceId}:body:${key}`,
					sourceDocumentId: sourceId,
					sourceRevision,
					sourcePath: `posts.${sourceId}.body.${key}`,
					targetDocumentKey: `sanity.post.${sourceId}`,
					targetPlacementKey: key,
					targetRole: "body",
					targetOrder: imageOrder,
				}),
			);
			imageOrder += 1;
		}
	}
	return placements.sort((left, right) => compareOrdinal(left.placementId, right.placementId));
}

function gearText(value: unknown, label: string) {
	if (value === undefined || value === null || value === "") return undefined;
	return requiredText(value, label);
}

function collectGear(
	source: SanityBlogReconciliationSource,
	postRevisions: ReadonlyMap<string, string>,
) {
	const entries: SourceGear[] = [];
	for (const postValue of source.posts) {
		const post = postValue as typeof postValue & JsonRecord;
		const sourcePostId = cleanSourceId(post._id);
		const sourceRevision = requireRevision(
			postRevisions.get(sourcePostId),
			`post ${sourcePostId}`,
		);
		if (post.gearUsed === undefined || post.gearUsed === null) continue;
		if (!Array.isArray(post.gearUsed)) throw new Error(`post ${sourcePostId} gearUsed is invalid`);
		for (const [sourceOrder, itemValue] of post.gearUsed.entries()) {
			const item = asRecord(itemValue, `post ${sourcePostId} gear item`);
			const sourceKey = requiredText(item._key, `post ${sourcePostId} gear key`);
			const sourceFields = {
				...(gearText(item.camera, `gear ${sourceKey} camera`)
					? { camera: gearText(item.camera, `gear ${sourceKey} camera`) }
					: {}),
				...(gearText(item.lens, `gear ${sourceKey} lens`)
					? { lens: gearText(item.lens, `gear ${sourceKey} lens`) }
					: {}),
				...(gearText(item.filmStock, `gear ${sourceKey} film stock`)
					? { filmStock: gearText(item.filmStock, `gear ${sourceKey} film stock`) }
					: {}),
				...(gearText(item.developer, `gear ${sourceKey} developer`)
					? { developer: gearText(item.developer, `gear ${sourceKey} developer`) }
					: {}),
			};
			if (Object.keys(sourceFields).length === 0) {
				throw new Error(`post ${sourcePostId} gear ${sourceKey} has no mappable role`);
			}
			entries.push({
				gearId: `post:${sourcePostId}:gear:${sourceKey}`,
				sourcePostId,
				sourceRevision,
				sourcePath: `posts.${sourcePostId}.gearUsed.${sourceKey}`,
				sourceKey,
				sourceOrder,
				source: sourceFields,
			});
		}
	}
	return entries.sort((left, right) => compareOrdinal(left.gearId, right.gearId));
}

const SYSTEM_FIELDS = new Set(["_createdAt", "_id", "_rev", "_type", "_updatedAt"]);
const AUTHOR_FIELDS = new Set([...SYSTEM_FIELDS, "bio", "image", "name", "slug"]);
const CATEGORY_FIELDS = new Set([...SYSTEM_FIELDS, "description", "title"]);
const POST_FIELDS = new Set([
	...SYSTEM_FIELDS,
	"approach",
	"author",
	"body",
	"brief",
	"categories",
	"gearUsed",
	"mainImage",
	"postType",
	"publishedAt",
	"result",
	"slug",
	"title",
]);
const IMAGE_FIELDS = new Set([
	"_key",
	"_type",
	"alt",
	"asset",
	"caption",
	"crop",
	"hotspot",
]);
const REFERENCE_FIELDS = new Set(["_key", "_ref", "_type", "_weak"]);
const SLUG_FIELDS = new Set(["_type", "current"]);
const GEAR_FIELDS = new Set([
	"_key",
	"_type",
	"camera",
	"developer",
	"filmStock",
	"lens",
]);

function canonicalJson(value: unknown): string {
	if (value === null) return "null";
	if (typeof value === "string" || typeof value === "boolean") return JSON.stringify(value);
	if (typeof value === "number") {
		if (!Number.isFinite(value)) throw new Error("Plan contains a non-finite number");
		return JSON.stringify(value);
	}
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (typeof value === "object") {
		return `{${Object.entries(value as JsonRecord)
			.filter(([, entry]) => entry !== undefined)
			.sort(([left], [right]) => compareOrdinal(left, right))
			.map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
			.join(",")}}`;
	}
	throw new Error("Plan contains an unsupported value");
}

function unexpectedFields(
	sourceDocumentId: string,
	basePath: string,
	value: unknown,
	allowed: ReadonlySet<string>,
) {
	if (value === undefined || value === null) return [];
	const record = asRecord(value, basePath);
	return Object.entries(record)
		.filter(([key]) => !allowed.has(key))
		.map(([key, sourceValue]) => ({
			sourceDocumentId,
			sourcePath: `${basePath}.${key}`,
			sourceValueCanonical: canonicalJson(sourceValue),
			action: "omit-owner-approved" as const,
		}));
}

function collectUnsupportedFields(source: SanityBlogReconciliationSource) {
	const fields: Array<Infer<typeof unsupportedFieldDecisionValidator>> = [];
	for (const [kind, documents, allowed] of [
		["authors", source.authors, AUTHOR_FIELDS],
		["categories", source.categories, CATEGORY_FIELDS],
		["posts", source.posts, POST_FIELDS],
	] as const) {
		for (const sourceValue of documents) {
			const sourceId = cleanSourceId(sourceValue._id);
			const sourceDocument = sourceValue as typeof sourceValue & JsonRecord;
			fields.push(...unexpectedFields(sourceId, `${kind}.${sourceId}`, sourceDocument, allowed));
			for (const [path, nestedValue, nestedAllowed] of [
				["slug", sourceDocument.slug, SLUG_FIELDS],
				["image", sourceDocument.image, IMAGE_FIELDS],
				["mainImage", sourceDocument.mainImage, IMAGE_FIELDS],
				["author", sourceDocument.author, REFERENCE_FIELDS],
			] as const) {
				fields.push(
					...unexpectedFields(
						sourceId,
						`${kind}.${sourceId}.${path}`,
						nestedValue,
						nestedAllowed,
					),
				);
			}
			if (Array.isArray(sourceDocument.categories)) {
				for (const [index, reference] of sourceDocument.categories.entries()) {
					fields.push(
						...unexpectedFields(
							sourceId,
							`${kind}.${sourceId}.categories.${index}`,
							reference,
							REFERENCE_FIELDS,
						),
					);
				}
			}
			if (Array.isArray(sourceDocument.gearUsed)) {
				for (const [index, gear] of sourceDocument.gearUsed.entries()) {
					fields.push(
						...unexpectedFields(
							sourceId,
							`${kind}.${sourceId}.gearUsed.${index}`,
							gear,
							GEAR_FIELDS,
						),
					);
				}
			}
			for (const [path, image] of [
				["image", sourceDocument.image],
				["mainImage", sourceDocument.mainImage],
			] as const) {
				if (typeof image !== "object" || image === null || Array.isArray(image)) continue;
				fields.push(
					...unexpectedFields(
						sourceId,
						`${kind}.${sourceId}.${path}.asset`,
						(image as JsonRecord).asset,
						REFERENCE_FIELDS,
					),
				);
			}
			if (Array.isArray(sourceDocument.body)) {
				for (const node of sourceDocument.body) {
					if (typeof node !== "object" || node === null || Array.isArray(node)) continue;
					const bodyNode = node as JsonRecord;
					if (bodyNode._type !== "image") continue;
					const key = typeof bodyNode._key === "string" ? bodyNode._key : "missing-key";
					fields.push(
						...unexpectedFields(
							sourceId,
							`${kind}.${sourceId}.body.${key}`,
							bodyNode,
							IMAGE_FIELDS,
						),
						...unexpectedFields(
							sourceId,
							`${kind}.${sourceId}.body.${key}.asset`,
							bodyNode.asset,
							REFERENCE_FIELDS,
						),
					);
				}
			}
		}
	}
	return fields.sort((left, right) => compareOrdinal(left.sourcePath, right.sourcePath));
}

function exactRecord<T>(
	value: Readonly<Record<string, T>>,
	expectedKeys: readonly string[],
	label: string,
) {
	if (!value || typeof value !== "object" || Array.isArray(value)) {
		throw new Error(`${label} decisions are invalid`);
	}
	assertExactStrings(sorted(Object.keys(value)), sorted(expectedKeys), `${label} decisions`);
	return value;
}

function exactTargets(
	value: Readonly<Record<string, SanityBlogTargetBaseline>>,
	documentKeys: readonly string[],
) {
	exactRecord(value, documentKeys, "Target baseline");
	for (const documentKey of documentKeys) {
		const target = value[documentKey];
		if (!target) throw new Error(`Target baseline ${documentKey} is missing`);
		requireDigest(target.draftChecksum, `Target ${documentKey} draft checksum`);
		if (!Number.isSafeInteger(target.rank) || target.rank < 0) {
			throw new Error(`Target ${documentKey} rank is invalid`);
		}
		if (target.documentSlug !== undefined) {
			requiredText(target.documentSlug, `Target ${documentKey} slug`);
		}
	}
	assertUnique(
		documentKeys.map((documentKey) => value[documentKey]?.documentId ?? ""),
		"Target document IDs",
	);
	assertUnique(
		documentKeys.map((documentKey) => value[documentKey]?.draftRevisionId ?? ""),
		"Target draft revision IDs",
	);
	return value;
}

function exactAssetMappings(
	placements: readonly SourceImagePlacement[],
	imageAssetIds: Readonly<Record<string, string>>,
) {
	const requiredRefs = sorted([
		...new Set(placements.map(({ sourceAssetRef }) => sourceAssetRef)),
	]);
	assertExactStrings(sorted(Object.keys(imageAssetIds)), requiredRefs, "Media mapping source refs");
	const mappings = requiredRefs.map((sourceAssetRef) => {
		const mediaAssetId = requiredText(
			imageAssetIds[sourceAssetRef],
			`Media mapping ${sourceAssetRef}`,
		);
		return { sourceAssetRef, mediaAssetId: mediaAssetId as Id<"mediaAssets"> };
	});
	assertUnique(mappings.map(({ mediaAssetId }) => mediaAssetId), "Media mapping target IDs");
	return mappings;
}

function resolvedImageDecisions(
	placements: readonly SourceImagePlacement[],
	inputs: Readonly<Record<string, ImagePlacementInput>>,
	assetMappings: readonly SanityBlogReconciliationPlan["assetMappings"][number][],
) {
	const decisions = exactRecord(
		inputs,
		placements.map(({ placementId }) => placementId),
		"Image placement",
	);
	const assetIds = new Map(assetMappings.map((mapping) => [mapping.sourceAssetRef, mapping.mediaAssetId]));
	return placements.map((placement) => {
		const decision = decisions[placement.placementId];
		if (!decision) throw new Error(`Image decision ${placement.placementId} is missing`);
		const altText = requiredText(decision.altText, `${placement.placementId} alt text`);
		if (decision.altAction === "accept-source" && altText !== placement.sourceAltText) {
			throw new Error(`${placement.placementId} accepted alt text differs from source`);
		}
		if (decision.captionAction === "confirmed-absent") {
			if (placement.sourceCaption !== undefined || decision.caption !== undefined) {
				throw new Error(`${placement.placementId} caption absence is contradicted`);
			}
		} else if (decision.captionAction === "accept-source") {
			if (!placement.sourceCaption || decision.caption !== placement.sourceCaption) {
				throw new Error(`${placement.placementId} accepted caption differs from source`);
			}
		} else {
			requiredText(decision.caption, `${placement.placementId} replacement caption`);
		}
		const hasFocalData = placement.sourceCrop !== undefined || placement.sourceHotspot !== undefined;
		if (
			(hasFocalData && decision.cropHotspotAction !== "omit-owner-approved")
			|| (!hasFocalData && decision.cropHotspotAction !== "confirmed-absent")
		) throw new Error(`${placement.placementId} crop/hotspot decision is invalid`);
		const mediaAssetId = assetIds.get(placement.sourceAssetRef);
		if (!mediaAssetId) throw new Error(`${placement.placementId} media mapping is missing`);
		return {
			...placement,
			mediaAssetId,
			altAction: decision.altAction,
			altText,
			captionAction: decision.captionAction,
			...(decision.caption === undefined ? {} : { caption: decision.caption }),
			cropHotspotAction: decision.cropHotspotAction,
		};
	});
}

function resolvedGearDecisions(
	gear: readonly SourceGear[],
	inputs: Readonly<Record<string, GearMappingInput>>,
) {
	const decisions = exactRecord(inputs, gear.map(({ gearId }) => gearId), "Gear mapping");
	return gear.map((source) => {
		const decision = decisions[source.gearId];
		if (!decision) throw new Error(`Gear decision ${source.gearId} is missing`);
		const targetKey = requiredText(decision.targetKey, `${source.gearId} target key`);
		const targetLabel = optionalText(decision.targetLabel, `${source.gearId} target label`);
		const targetDetails = optionalText(decision.targetDetails, `${source.gearId} target details`);
		if (!targetLabel && !targetDetails) {
			throw new Error(`${source.gearId} target mapping must preserve visible gear text`);
		}
		return {
			...source,
			action: decision.action,
			targetKey,
			...(targetLabel ? { targetLabel } : {}),
			...(targetDetails ? { targetDetails } : {}),
		};
	});
}

function imageDecisionByTarget(
	decisions: readonly SanityBlogReconciliationPlan["decisionSet"]["imagePlacements"][number][],
) {
	return new Map(
		decisions.map((decision) => [
			`${decision.targetDocumentKey}:${decision.targetRole}:${decision.targetPlacementKey}`,
			decision,
		]),
	);
}

function requireImageDecision(
	decisions: ReturnType<typeof imageDecisionByTarget>,
	documentKey: string,
	role: "portrait" | "main" | "body",
	placementKey: string,
) {
	const decision = decisions.get(`${documentKey}:${role}:${placementKey}`);
	if (!decision) throw new Error(`Image decision for ${documentKey}/${role}/${placementKey} is missing`);
	return decision;
}

function createSupportingDocuments(
	manifest: SanityBlogImportManifest,
	revisions: { authors: ReadonlyMap<string, string>; categories: ReadonlyMap<string, string> },
	targets: Readonly<Record<string, SanityBlogTargetBaseline>>,
	categorySlugs: Readonly<Record<string, string>>,
	images: ReturnType<typeof imageDecisionByTarget>,
) {
	const authors = manifest.authors.map((author) => {
		const { portrait, ...draftFields } = author.draft;
		const portraitDecision = portrait
			? requireImageDecision(images, author.documentKey, "portrait", portrait.key)
			: undefined;
		const draft: BlogSupportingDraft = {
			...draftFields,
			...(portraitDecision
				? {
						portrait: {
							key: portraitDecision.targetPlacementKey,
							assetId: portraitDecision.mediaAssetId,
							altText: portraitDecision.altText,
							...(portraitDecision.caption === undefined
								? {}
								: { caption: portraitDecision.caption }),
						},
					}
				: {}),
		};
		return {
			sourceId: author.sourceId,
			sourceRevision: requireRevision(revisions.authors.get(author.sourceId), `author ${author.sourceId}`),
			documentKey: author.documentKey,
			target: targets[author.documentKey],
			draft,
		};
	});
	const categories = manifest.categories.map((category) => ({
		sourceId: category.sourceId,
		sourceRevision: requireRevision(
			revisions.categories.get(category.sourceId),
			`category ${category.sourceId}`,
		),
		documentKey: category.documentKey,
		target: targets[category.documentKey],
		draft: {
			...category.draft,
			slug: requiredText(
				categorySlugs[category.sourceId],
				`category ${category.sourceId} slug decision`,
			),
		} as BlogSupportingDraft,
	}));
	return {
		authors: authors.sort((left, right) => compareOrdinal(left.documentKey, right.documentKey)),
		categories: categories.sort((left, right) => compareOrdinal(left.documentKey, right.documentKey)),
	};
}

function createPostDocuments(
	manifest: SanityBlogImportManifest,
	postRevisions: ReadonlyMap<string, string>,
	targets: Readonly<Record<string, SanityBlogTargetBaseline>>,
	postSummaries: Readonly<Record<string, string>>,
	images: ReturnType<typeof imageDecisionByTarget>,
	gear: readonly SanityBlogReconciliationPlan["decisionSet"]["gearMappings"][number][],
) {
	const gearByPost = new Map<string, typeof gear>();
	for (const entry of gear) {
		gearByPost.set(entry.sourcePostId, [...(gearByPost.get(entry.sourcePostId) ?? []), entry]);
	}
	for (const [sourcePostId, entries] of gearByPost) {
		gearByPost.set(
			sourcePostId,
			[...entries].sort((left, right) => left.sourceOrder - right.sourceOrder),
		);
	}
	return manifest.posts
		.map((post) => {
			const { authorDocumentKey, categories, mainImage, equipment: _generated, ...draftFields } =
				post.draft;
			if (!authorDocumentKey) throw new Error(`post ${post.sourceId} has no Author`);
			const mainDecision = mainImage
				? requireImageDecision(images, post.documentKey, "main", mainImage.key)
				: undefined;
			const body = {
				...draftFields.body,
				blocks: draftFields.body.blocks.map((block) => {
					if (block.type !== "image") return block;
					const decision = requireImageDecision(images, post.documentKey, "body", block.key);
					return {
						...block,
						assetId: decision.mediaAssetId,
						altText: decision.altText,
						...(decision.caption === undefined ? { caption: undefined } : { caption: decision.caption }),
					};
				}),
			};
			const draft: PostDraft = {
				...draftFields,
				body,
				summary: requiredText(
					postSummaries[post.sourceId],
					`post ${post.sourceId} summary decision`,
				),
				equipment: (gearByPost.get(post.sourceId) ?? []).map((entry) => ({
					key: entry.targetKey,
					...(entry.targetLabel === undefined ? {} : { label: entry.targetLabel }),
					...(entry.targetDetails === undefined ? {} : { details: entry.targetDetails }),
				})),
				materials: [],
				categories: [],
				authorDocumentId: undefined,
				...(mainDecision
					? {
							mainImage: {
								key: mainDecision.targetPlacementKey,
								assetId: mainDecision.mediaAssetId,
								altText: mainDecision.altText,
								...(mainDecision.caption === undefined
									? {}
									: { caption: mainDecision.caption }),
							},
						}
					: {}),
			};
			return {
				sourceId: post.sourceId,
				sourceRevision: requireRevision(postRevisions.get(post.sourceId), `post ${post.sourceId}`),
				documentKey: post.documentKey,
				authorDocumentKey,
				categoryReferences: categories,
				target: targets[post.documentKey],
				draft,
			};
		})
		.sort((left, right) => compareOrdinal(left.documentKey, right.documentKey));
}

/** Build a fully reviewed, revision-pinned v2 plan without provider access or writes. */
export function createSanityBlogReconciliationPlan(
	source: SanityBlogReconciliationSource,
	options: SanityBlogReconciliationBuildOptions,
): SanityBlogReconciliationPlan {
	requireStableId(options.migrationId, "Migration ID");
	requireStableId(options.decisions.id, "Decision set ID");
	const revisions = {
		authors: sourceRevisions(source.authors, "author"),
		categories: sourceRevisions(source.categories, "category"),
		posts: sourceRevisions(source.posts, "post"),
	};
	for (const post of source.posts) {
		if (
			!new Set(["standard", "caseStudy", "clientStory", "technical", "behindTheScenes"])
				.has(String(post.postType))
		) throw new Error(`Post ${cleanSourceId(post._id)} has an invalid presentation type`);
		if (
			typeof post.publishedAt !== "string"
			|| !Number.isFinite(Date.parse(post.publishedAt))
		) throw new Error(`Post ${cleanSourceId(post._id)} has an invalid publication time`);
	}
	const sourcePlacements = collectImagePlacements(source, revisions);
	const assetMappings = exactAssetMappings(sourcePlacements, options.imageAssetIds);
	const manifest = createSanityBlogImportManifest(source, {
		imageAssetIds: options.imageAssetIds,
	});
	const report = createSanityBlogImportDryRunReport(manifest);
	if (report.draftImport.status === "blocked") {
		throw new Error("Revision-pinned Blog source is not ready for reconciliation planning");
	}
	const imagePlacements = resolvedImageDecisions(
		sourcePlacements,
		options.decisions.imagePlacements,
		assetMappings,
	);
	const gearMappings = resolvedGearDecisions(
		collectGear(source, revisions.posts),
		options.decisions.gearMappings,
	);
	const categorySlugs = exactRecord(
		options.decisions.categorySlugs,
		manifest.categories.map(({ sourceId }) => sourceId),
		"Category slug",
	);
	assertUnique(Object.values(categorySlugs), "Category slug decisions");
	const postSummaries = exactRecord(
		options.decisions.postSummaries,
		manifest.posts.map(({ sourceId }) => sourceId),
		"Post summary",
	);
	const expectedUnsupported = collectUnsupportedFields(source);
	const actualUnsupported = [...options.decisions.unsupportedFields].sort((left, right) =>
		compareOrdinal(left.sourcePath, right.sourcePath),
	);
	if (canonicalJson(actualUnsupported) !== canonicalJson(expectedUnsupported)) {
		throw new Error("Unsupported-field decisions must exactly match the source inventory");
	}
	const documentKeys = [
		...manifest.authors.map(({ documentKey }) => documentKey),
		...manifest.categories.map(({ documentKey }) => documentKey),
		...manifest.posts.map(({ documentKey }) => documentKey),
	];
	const targets = exactTargets(options.targets, documentKeys);
	const imageByTarget = imageDecisionByTarget(imagePlacements);
	if (imageByTarget.size !== imagePlacements.length) {
		throw new Error("Image placement target identities must be unique");
	}
	const supporting = createSupportingDocuments(
		manifest,
		revisions,
		targets,
		categorySlugs,
		imageByTarget,
	);
	const posts = createPostDocuments(
		manifest,
		revisions.posts,
		targets,
		postSummaries,
		imageByTarget,
		gearMappings,
	);
	const plan: SanityBlogReconciliationPlan = {
		version: 2,
		migrationId: options.migrationId,
		siteUrl: options.siteUrl,
		source: options.source,
		predecessor: {
			version: 1,
			migrationId: options.predecessor.migrationId,
			siteUrl: options.predecessor.siteUrl,
			expectedDigest: options.predecessor.expectedDigest,
			source: options.predecessor.source,
		},
		decisionSet: {
			id: options.decisions.id,
			categorySlugs: Object.entries(categorySlugs)
				.map(([sourceId, slug]) => ({ sourceId, slug }))
				.sort((left, right) => compareOrdinal(left.sourceId, right.sourceId)),
			postSummaries: Object.entries(postSummaries)
				.map(([sourceId, summary]) => ({ sourceId, summary }))
				.sort((left, right) => compareOrdinal(left.sourceId, right.sourceId)),
			imagePlacements,
			gearMappings,
			unsupportedFields: actualUnsupported,
			absentTargetFields: [...options.decisions.absentTargetFields].sort((left, right) =>
				compareOrdinal(left.field, right.field),
			),
		},
		assetMappings,
		authors: supporting.authors,
		categories: supporting.categories,
		posts,
	};
	assertSanityBlogReconciliationPlan(plan);
	assertSanityBlogReconciliationPredecessor(plan, options.predecessor);
	return plan;
}

export function resolveSanityBlogReconciliationPostDraft(
	plan: SanityBlogReconciliationPlan,
	item: SanityBlogReconciliationPlan["posts"][number],
) {
	const targets = new Map(
		[...plan.authors, ...plan.categories, ...plan.posts].map((entry) => [
			entry.documentKey,
			entry.target.documentId,
		]),
	);
	const authorDocumentId = targets.get(item.authorDocumentKey);
	if (!authorDocumentId) throw new Error("Post Author target is outside the plan");
	return {
		...item.draft,
		authorDocumentId,
		categories: item.categoryReferences.map((reference) => {
			const documentId = targets.get(reference.documentKey);
			if (!documentId) throw new Error("Post Category target is outside the plan");
			return { key: reference.key, documentId };
		}),
	};
}

function targetMediaPlacements(plan: SanityBlogReconciliationPlan) {
	const placements: string[] = [];
	for (const author of plan.authors) {
		if (author.draft.kind !== "author" || !author.draft.portrait) continue;
		const portrait = author.draft.portrait;
		placements.push(
			canonicalJson({
				targetDocumentKey: author.documentKey,
				targetRole: "portrait",
				targetPlacementKey: portrait.key,
				targetOrder: 0,
				mediaAssetId: portrait.assetId,
				altText: portrait.altText,
				caption: portrait.caption,
			}),
		);
	}
	for (const post of plan.posts) {
		if (post.draft.mainImage) {
			const main = post.draft.mainImage;
			placements.push(
				canonicalJson({
					targetDocumentKey: post.documentKey,
					targetRole: "main",
					targetPlacementKey: main.key,
					targetOrder: 0,
					mediaAssetId: main.assetId,
					altText: main.altText,
					caption: main.caption,
				}),
			);
		}
		let bodyOrder = 0;
		for (const block of post.draft.body.blocks) {
			if (block.type !== "image") continue;
			placements.push(
				canonicalJson({
					targetDocumentKey: post.documentKey,
					targetRole: "body",
					targetPlacementKey: block.key,
					targetOrder: bodyOrder,
					mediaAssetId: block.assetId,
					altText: block.altText,
					caption: block.caption,
				}),
			);
			bodyOrder += 1;
		}
	}
	return sorted(placements);
}

function acceptedMediaPlacements(plan: SanityBlogReconciliationPlan) {
	return sorted(
		plan.decisionSet.imagePlacements.map((placement) =>
			canonicalJson({
				targetDocumentKey: placement.targetDocumentKey,
				targetRole: placement.targetRole,
				targetPlacementKey: placement.targetPlacementKey,
				targetOrder: placement.targetOrder,
				mediaAssetId: placement.mediaAssetId,
				altText: placement.altText,
				caption: placement.caption,
			}),
		),
	);
}

/** Runtime semantic validation; called before both hashing and every mutation. */
export function assertSanityBlogReconciliationPlan(plan: SanityBlogReconciliationPlan) {
	if (plan.version !== 2 || plan.source.perspective !== "published") {
		throw new Error("Blog reconciliation source identity is invalid");
	}
	requireStableId(plan.migrationId, "Migration ID");
	requireStableId(plan.decisionSet.id, "Decision set ID");
	requireStableId(plan.siteUrl, "Site URL");
	requireStableId(plan.source.projectId, "Sanity project ID");
	requireStableId(plan.source.dataset, "Sanity dataset");
	requireStableId(plan.predecessor.migrationId, "Predecessor migration ID");
	requireDigest(plan.predecessor.expectedDigest, "Predecessor digest");
	if (
		plan.predecessor.version !== 1
		|| plan.predecessor.siteUrl !== plan.siteUrl
		|| plan.predecessor.source.perspective !== "published"
		|| plan.predecessor.source.projectId !== plan.source.projectId
		|| plan.predecessor.source.dataset !== plan.source.dataset
	) throw new Error("Predecessor source identity is invalid");

	const authorKeys = new Set(plan.authors.map(({ documentKey }) => documentKey));
	const categoryKeys = new Set(plan.categories.map(({ documentKey }) => documentKey));
	const allItems = [...plan.authors, ...plan.categories, ...plan.posts];
	const allKeys = allItems.map(({ documentKey }) => documentKey);
	const itemsBySourceId = new Map(allItems.map((item) => [item.sourceId, item]));
	const itemsByDocumentKey = new Map(allItems.map((item) => [item.documentKey, item]));
	assertUnique(allKeys, "Reconciliation document keys");
	assertUnique(allItems.map(({ sourceId }) => sourceId), "Reconciliation source IDs");
	assertUnique(allItems.map(({ target }) => target.documentId), "Reconciliation target documents");
	assertUnique(
		allItems.map(({ target }) => target.draftRevisionId),
		"Reconciliation baseline revisions",
	);
	for (const [label, items] of [
		["Author", plan.authors],
		["Category", plan.categories],
		["Post", plan.posts],
	] as const) {
		assertExactStrings(
			items.map(({ documentKey }) => documentKey),
			sorted(items.map(({ documentKey }) => documentKey)),
			`${label} canonical order`,
		);
		for (const item of items) {
			requireRevision(item.sourceRevision, `${label} ${item.sourceId} revision`);
			requireDigest(item.target.draftChecksum, `${label} ${item.sourceId} target checksum`);
			if (!Number.isSafeInteger(item.target.rank) || item.target.rank < 0) {
				throw new Error(`${label} ${item.sourceId} target rank is invalid`);
			}
		}
	}
	for (const item of plan.authors) {
		validateBlogDocumentKey(item.documentKey);
		if (item.draft.kind !== "author" || item.documentKey !== `sanity.author.${item.sourceId}`) {
			throw new Error("Author source identity mismatch");
		}
		toPublishedBlogSupportingContent(item.draft);
	}
	for (const item of plan.categories) {
		validateBlogDocumentKey(item.documentKey);
		if (item.draft.kind !== "category" || item.documentKey !== `sanity.category.${item.sourceId}`) {
			throw new Error("Category source identity mismatch");
		}
		toPublishedBlogSupportingContent(item.draft);
	}
	for (const item of plan.posts) {
		validatePostDocumentKey(item.documentKey);
		if (item.documentKey !== `sanity.post.${item.sourceId}`) {
			throw new Error("Post source identity mismatch");
		}
		if (item.draft.authorDocumentId || item.draft.categories.length > 0) {
			throw new Error("Post relations must remain document keys until reconciliation");
		}
		if (!authorKeys.has(item.authorDocumentKey)) throw new Error("Post Author is outside plan");
		assertUnique(
			item.categoryReferences.map(({ key }) => key),
			`Post ${item.sourceId} Category keys`,
		);
		if (item.categoryReferences.some(({ documentKey }) => !categoryKeys.has(documentKey))) {
			throw new Error("Post Category is outside plan");
		}
		toPublishedPostDraft(resolveSanityBlogReconciliationPostDraft(plan, item));
		if (
			item.draft.credits !== undefined
			|| item.draft.seoDescription !== undefined
			|| item.draft.seoTitle !== undefined
			|| item.draft.materials.length !== 0
		) throw new Error("Owner-accepted absent target fields must remain absent");
	}

	const categoryDecisionIds = plan.decisionSet.categorySlugs.map(({ sourceId }) => sourceId);
	assertExactStrings(
		categoryDecisionIds,
		sorted(plan.categories.map(({ sourceId }) => sourceId)),
		"Category slug decisions",
	);
	const categoryDecisions = new Map(
		plan.decisionSet.categorySlugs.map((decision) => [decision.sourceId, decision.slug]),
	);
	assertUnique(
		plan.decisionSet.categorySlugs.map(({ slug }) => slug),
		"Category slug decisions",
	);
	for (const item of plan.categories) {
		if (item.draft.slug !== categoryDecisions.get(item.sourceId)) {
			throw new Error("Category slug decision was not applied");
		}
	}
	const summaryDecisionIds = plan.decisionSet.postSummaries.map(({ sourceId }) => sourceId);
	assertExactStrings(
		summaryDecisionIds,
		sorted(plan.posts.map(({ sourceId }) => sourceId)),
		"Post summary decisions",
	);
	const summaryDecisions = new Map(
		plan.decisionSet.postSummaries.map((decision) => [decision.sourceId, decision.summary]),
	);
	for (const item of plan.posts) {
		if (item.draft.summary !== summaryDecisions.get(item.sourceId)) {
			throw new Error("Post summary decision was not applied");
		}
	}

	const expectedAbsent = ["credits", "materials", "seoDescription", "seoTitle"];
	assertExactStrings(
		plan.decisionSet.absentTargetFields.map(({ field }) => field),
		expectedAbsent,
		"Absent target-field decisions",
	);
	assertExactStrings(
		plan.decisionSet.imagePlacements.map(({ placementId }) => placementId),
		sorted(plan.decisionSet.imagePlacements.map(({ placementId }) => placementId)),
		"Image placement decision order",
	);
	assertUnique(
		plan.decisionSet.imagePlacements.map(({ placementId }) => placementId),
		"Image placement IDs",
	);
	for (const placement of plan.decisionSet.imagePlacements) {
		requireRevision(placement.sourceRevision, `${placement.placementId} source revision`);
		const sourceItem = itemsBySourceId.get(placement.sourceDocumentId);
		const targetItem = itemsByDocumentKey.get(placement.targetDocumentKey);
		if (
			!sourceItem
			|| sourceItem.sourceRevision !== placement.sourceRevision
			|| !targetItem
			|| targetItem.sourceId !== placement.sourceDocumentId
			|| (placement.targetRole === "portrait" && targetItem.draft.kind !== "author")
			|| (placement.targetRole !== "portrait" && targetItem.draft.kind !== "post")
		) throw new Error(`${placement.placementId} source/target identity is invalid`);
		if (!SANITY_IMAGE_REF_PATTERN.test(placement.sourceAssetRef)) {
			throw new Error(`${placement.placementId} source asset reference is invalid`);
		}
		requiredText(placement.altText, `${placement.placementId} alt text`);
		if (placement.altAction === "accept-source" && placement.altText !== placement.sourceAltText) {
			throw new Error(`${placement.placementId} accepted alt text differs from source`);
		}
		const hasFocalData = placement.sourceCrop !== undefined || placement.sourceHotspot !== undefined;
		if (placement.sourceCrop) sourceCrop(placement.sourceCrop, `${placement.placementId}.sourceCrop`);
		if (placement.sourceHotspot) {
			sourceHotspot(placement.sourceHotspot, `${placement.placementId}.sourceHotspot`);
		}
		if (
			(hasFocalData && placement.cropHotspotAction !== "omit-owner-approved")
			|| (!hasFocalData && placement.cropHotspotAction !== "confirmed-absent")
		) throw new Error(`${placement.placementId} crop/hotspot decision is invalid`);
		if (placement.captionAction === "confirmed-absent") {
			if (placement.sourceCaption !== undefined || placement.caption !== undefined) {
				throw new Error(`${placement.placementId} caption absence is contradicted`);
			}
		} else if (placement.captionAction === "accept-source") {
			if (!placement.sourceCaption || placement.caption !== placement.sourceCaption) {
				throw new Error(`${placement.placementId} accepted caption differs from source`);
			}
		} else requiredText(placement.caption, `${placement.placementId} replacement caption`);
	}
	assertExactStrings(
		targetMediaPlacements(plan),
		acceptedMediaPlacements(plan),
		"Final media placements",
	);
	const mappingRefs = plan.assetMappings.map(({ sourceAssetRef }) => sourceAssetRef);
	const mappingIds = plan.assetMappings.map(({ mediaAssetId }) => mediaAssetId);
	assertExactStrings(mappingRefs, sorted(mappingRefs), "Media mapping order");
	assertUnique(mappingRefs, "Media mapping source refs");
	assertUnique(mappingIds, "Media mapping target IDs");
	const placementRefs = sorted([
		...new Set(plan.decisionSet.imagePlacements.map(({ sourceAssetRef }) => sourceAssetRef)),
	]);
	assertExactStrings(mappingRefs, placementRefs, "Media mapping coverage");
	const mappingByRef = new Map(
		plan.assetMappings.map(({ sourceAssetRef, mediaAssetId }) => [sourceAssetRef, mediaAssetId]),
	);
	for (const placement of plan.decisionSet.imagePlacements) {
		if (mappingByRef.get(placement.sourceAssetRef) !== placement.mediaAssetId) {
			throw new Error(`${placement.placementId} substitutes the accepted media mapping`);
		}
	}

	assertExactStrings(
		plan.decisionSet.gearMappings.map(({ gearId }) => gearId),
		sorted(plan.decisionSet.gearMappings.map(({ gearId }) => gearId)),
		"Gear decision order",
	);
	assertUnique(plan.decisionSet.gearMappings.map(({ gearId }) => gearId), "Gear decision IDs");
	for (const gear of plan.decisionSet.gearMappings) {
		const sourcePost = plan.posts.find(({ sourceId }) => sourceId === gear.sourcePostId);
		if (!sourcePost || sourcePost.sourceRevision !== gear.sourceRevision) {
			throw new Error(`${gear.gearId} source Post identity is invalid`);
		}
		if (Object.values(gear.source).every((value) => value === undefined)) {
			throw new Error(`${gear.gearId} source roles are empty`);
		}
	}
	for (const post of plan.posts) {
		const expected = plan.decisionSet.gearMappings
			.filter(({ sourcePostId }) => sourcePostId === post.sourceId)
			.sort((left, right) => left.sourceOrder - right.sourceOrder)
			.map((entry) => ({
				key: entry.targetKey,
				...(entry.targetLabel === undefined ? {} : { label: entry.targetLabel }),
				...(entry.targetDetails === undefined ? {} : { details: entry.targetDetails }),
			}));
		if (canonicalJson(post.draft.equipment) !== canonicalJson(expected)) {
			throw new Error(`Post ${post.sourceId} gear decisions were not applied`);
		}
		const sourceOrders = plan.decisionSet.gearMappings
			.filter(({ sourcePostId }) => sourcePostId === post.sourceId)
			.map(({ sourceOrder }) => sourceOrder)
			.sort((left, right) => left - right);
		if (sourceOrders.some((sourceOrder, index) => sourceOrder !== index)) {
			throw new Error(`Post ${post.sourceId} gear source order is invalid`);
		}
	}
	assertExactStrings(
		plan.decisionSet.unsupportedFields.map(({ sourcePath }) => sourcePath),
		sorted(plan.decisionSet.unsupportedFields.map(({ sourcePath }) => sourcePath)),
		"Unsupported-field decision order",
	);
	assertUnique(
		plan.decisionSet.unsupportedFields.map(({ sourcePath }) => sourcePath),
		"Unsupported-field source paths",
	);
	for (const field of plan.decisionSet.unsupportedFields) {
		if (!itemsBySourceId.has(field.sourceDocumentId)) {
			throw new Error(`${field.sourcePath} source document is outside the plan`);
		}
		let parsed: unknown;
		try {
			parsed = JSON.parse(field.sourceValueCanonical) as unknown;
		} catch {
			throw new Error(`${field.sourcePath} source value is not canonical JSON`);
		}
		if (canonicalJson(parsed) !== field.sourceValueCanonical) {
			throw new Error(`${field.sourcePath} source value is not canonical JSON`);
		}
	}
}

export function canonicalSanityBlogReconciliationPlan(
	plan: SanityBlogReconciliationPlan,
) {
	assertSanityBlogReconciliationPlan(plan);
	return `sanity-blog-reconciliation-plan:v2:${canonicalJson(plan)}`;
}

export async function checksumSanityBlogReconciliationPlan(
	plan: SanityBlogReconciliationPlan,
) {
	const digest = await crypto.subtle.digest(
		"SHA-256",
		new TextEncoder().encode(canonicalSanityBlogReconciliationPlan(plan)),
	);
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

export async function requireSanityBlogReconciliationPlan(
	plan: SanityBlogReconciliationPlan,
	claimedDigest: string,
) {
	requireDigest(claimedDigest, "Reconciliation plan digest");
	const actualDigest = await checksumSanityBlogReconciliationPlan(plan);
	if (claimedDigest !== actualDigest) {
		throw new Error("Reconciliation plan digest does not match its canonical bytes");
	}
	return actualDigest;
}

/** Bind production execution to the accepted v1 release without changing it. */
export function assertSanityBlogReconciliationPredecessor(
	plan: SanityBlogReconciliationPlan,
	contract: SanityBlogImportReleaseContract,
) {
	if (
		plan.predecessor.version !== contract.version ||
		plan.predecessor.migrationId !== contract.migrationId ||
		plan.predecessor.siteUrl !== contract.siteUrl ||
		plan.predecessor.expectedDigest !== contract.expectedDigest ||
		plan.predecessor.source.projectId !== contract.source.projectId ||
		plan.predecessor.source.dataset !== contract.source.dataset ||
		plan.predecessor.source.perspective !== contract.source.perspective
	)
		throw new Error("Reconciliation predecessor does not match the accepted v1 release");
	assertExactStrings(
		plan.authors.map(({ documentKey }) => documentKey),
		contract.documentKeys.authors,
		"Predecessor Author document keys",
	);
	assertExactStrings(
		plan.categories.map(({ documentKey }) => documentKey),
		contract.documentKeys.categories,
		"Predecessor Category document keys",
	);
	assertExactStrings(
		plan.posts.map(({ documentKey }) => documentKey),
		contract.documentKeys.posts,
		"Predecessor Post document keys",
	);
}
