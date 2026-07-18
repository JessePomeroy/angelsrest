import type {
	SanityBlogImportManifest,
	SanityBlogImportSource,
} from "../../packages/crm-api/convex/helpers/sanityBlogImport";

export const SANITY_BLOG_IMAGE_ASSET_MAP_FILENAME = "sanity-blog-image-asset-map.json";
export const SANITY_BLOG_REVIEW_CHECKLIST_FILENAME = "sanity-blog-review-checklist.md";

export type SanityBlogImportPlacement = {
	kind: "author" | "post";
	role: "portrait" | "mainImage" | "bodyImage";
	sourceId: string;
	documentKey: string;
	slug: string | null;
	path: string;
};

export type SanityBlogImportAssetUsage = {
	sourceAssetRef: string;
	mapped: boolean;
	targetAssetId?: string;
	placements: SanityBlogImportPlacement[];
};

export type SanityBlogImportAltTextRemediation = SanityBlogImportPlacement & {
	sourceAssetRef?: string;
};

export type SanityBlogImportRemediation = {
	assetMappings: SanityBlogImportAssetUsage[];
	altText: SanityBlogImportAltTextRemediation[];
	counts: {
		assetMappings: number;
		unmappedAssets: number;
		altText: number;
	};
};

type SanityReference = {
	_ref?: unknown;
};

type SanityImageLike = {
	asset?: SanityReference;
	alt?: unknown;
};

const SANITY_IMAGE_REF_PATTERN = /^image-([a-zA-Z0-9]+)-(\d+x\d+)-([a-zA-Z0-9]+)$/;

function inlineCode(value: string) {
	return `\`${value.replaceAll("`", "'")}\``;
}

function text(value: unknown) {
	return typeof value === "string" ? value.trim() : undefined;
}

function sourceReference(value: SanityReference | undefined) {
	const ref = text(value?._ref);
	return ref?.replace(/^drafts\./, "");
}

function imageSourceRef(value: SanityImageLike | undefined) {
	const ref = sourceReference(value?.asset);
	return ref?.startsWith("image-") ? ref : undefined;
}

function bodyImageEntries(body: unknown) {
	if (!Array.isArray(body)) return [];
	return body
		.map((node, index) => {
			if (
				typeof node !== "object" ||
				node === null ||
				!("_type" in node) ||
				node._type !== "image"
			) {
				return null;
			}
			return { index, image: node as SanityImageLike };
		})
		.filter((entry): entry is { index: number; image: SanityImageLike } => entry !== null);
}

function addAssetUsage(
	usages: Map<string, SanityBlogImportAssetUsage>,
	imageAssetIds: Readonly<Record<string, string>>,
	sourceAssetRef: string,
	placement: SanityBlogImportPlacement,
) {
	const existing = usages.get(sourceAssetRef);
	if (existing) {
		existing.placements.push(placement);
		return;
	}
	const targetAssetId = imageAssetIds[sourceAssetRef];
	usages.set(sourceAssetRef, {
		sourceAssetRef,
		mapped: Boolean(targetAssetId),
		...(targetAssetId ? { targetAssetId } : {}),
		placements: [placement],
	});
}

export function createSanityBlogImportRemediation(
	source: SanityBlogImportSource,
	manifest: SanityBlogImportManifest,
	imageAssetIds: Readonly<Record<string, string>>,
): SanityBlogImportRemediation {
	const assetUsages = new Map<string, SanityBlogImportAssetUsage>();
	const altText: SanityBlogImportAltTextRemediation[] = [];
	const authors = new Map(manifest.authors.map((author) => [author.sourceId, author]));
	const posts = new Map(manifest.posts.map((post) => [post.sourceId, post]));

	for (const [authorIndex, authorSource] of source.authors.entries()) {
		const sourceId = authorSource._id.replace(/^drafts\./, "");
		const author = authors.get(sourceId);
		if (!author) continue;
		const sourceAssetRef = imageSourceRef(authorSource.image);
		if (!sourceAssetRef) continue;
		const placement = {
			kind: "author" as const,
			role: "portrait" as const,
			sourceId,
			documentKey: author.documentKey,
			slug: author.draft.slug ?? null,
			path: `$.authors[${authorIndex}].image`,
		};
		addAssetUsage(assetUsages, imageAssetIds, sourceAssetRef, placement);
		if (!text(authorSource.image?.alt)) altText.push({ ...placement, sourceAssetRef });
	}

	for (const [postIndex, postSource] of source.posts.entries()) {
		const sourceId = postSource._id.replace(/^drafts\./, "");
		const post = posts.get(sourceId);
		if (!post) continue;
		const mainImageRef = imageSourceRef(postSource.mainImage);
		if (mainImageRef) {
			const placement = {
				kind: "post" as const,
				role: "mainImage" as const,
				sourceId,
				documentKey: post.documentKey,
				slug: post.draft.slug ?? null,
				path: `$.posts[${postIndex}].mainImage`,
			};
			addAssetUsage(assetUsages, imageAssetIds, mainImageRef, placement);
			if (!text(postSource.mainImage?.alt)) {
				altText.push({ ...placement, sourceAssetRef: mainImageRef });
			}
		}
		for (const { index: bodyIndex, image } of bodyImageEntries(postSource.body)) {
			const bodyImageRef = imageSourceRef(image);
			const placement = {
				kind: "post" as const,
				role: "bodyImage" as const,
				sourceId,
				documentKey: post.documentKey,
				slug: post.draft.slug ?? null,
				path: `$.posts[${postIndex}].body[${bodyIndex}]`,
			};
			if (bodyImageRef) addAssetUsage(assetUsages, imageAssetIds, bodyImageRef, placement);
			if (!text(image.alt)) {
				altText.push({
					...placement,
					...(bodyImageRef ? { sourceAssetRef: bodyImageRef } : {}),
				});
			}
		}
	}

	const assetMappings = Array.from(assetUsages.values())
		.map((usage) => ({
			...usage,
			placements: usage.placements.sort((a, b) => a.path.localeCompare(b.path)),
		}))
		.sort((a, b) => a.sourceAssetRef.localeCompare(b.sourceAssetRef));

	return {
		assetMappings,
		altText: altText.sort((a, b) => a.path.localeCompare(b.path)),
		counts: {
			assetMappings: assetMappings.length,
			unmappedAssets: assetMappings.filter((usage) => !usage.mapped).length,
			altText: altText.length,
		},
	};
}

function placementLabel(placement: SanityBlogImportPlacement) {
	const document = placement.slug ? `${placement.kind} / ${placement.slug}` : placement.documentKey;
	return `${document} / ${placement.role}`;
}

export function sanityImageSourceUrl(projectId: string, dataset: string, sourceAssetRef: string) {
	const match = SANITY_IMAGE_REF_PATTERN.exec(sourceAssetRef);
	if (!match) return null;
	const [, hash, dimensions, extension] = match;
	return `https://cdn.sanity.io/images/${encodeURIComponent(projectId)}/${encodeURIComponent(dataset)}/${hash}-${dimensions}.${extension}`;
}

export function parseSanityBlogImageAssetMap(value: unknown) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) {
		throw new Error("--image-asset-map must point at a JSON object");
	}
	const mappings: Record<string, string> = {};
	for (const [sourceAssetRef, targetAssetId] of Object.entries(value)) {
		if (!SANITY_IMAGE_REF_PATTERN.test(sourceAssetRef)) {
			throw new Error(
				`Invalid Sanity image asset reference in --image-asset-map: ${sourceAssetRef}`,
			);
		}
		if (typeof targetAssetId !== "string") {
			throw new Error(`Image asset mapping for ${sourceAssetRef} must be a string`);
		}
		if (targetAssetId !== targetAssetId.trim()) {
			throw new Error(
				`Image asset mapping for ${sourceAssetRef} must not contain surrounding whitespace`,
			);
		}
		if (targetAssetId) mappings[sourceAssetRef] = targetAssetId;
	}
	return mappings;
}

export function createSanityBlogImportPrepArtifacts({
	projectId,
	dataset,
	remediation,
}: {
	projectId: string;
	dataset: string;
	remediation: SanityBlogImportRemediation;
}) {
	const assets = [...remediation.assetMappings].sort((a, b) =>
		a.sourceAssetRef.localeCompare(b.sourceAssetRef),
	);
	const altText = [...remediation.altText].sort((a, b) => a.path.localeCompare(b.path));
	const imageAssetMap = Object.fromEntries(
		assets.map((asset) => [asset.sourceAssetRef, asset.targetAssetId?.trim() ?? ""]),
	);
	const suppliedMappings = Object.values(imageAssetMap).filter(Boolean).length;
	const lines = [
		"# Sanity Blog media preparation",
		"",
		`Published source: ${inlineCode(`${projectId}/${dataset}`)}.`,
		"",
		"This is a review artifact only. Generating it does not upload media, write Convex content, change the public Blog provider, or modify Sanity.",
		"",
		`Fill each blank value in ${inlineCode(SANITY_BLOG_IMAGE_ASSET_MAP_FILENAME)} with the matching Convex ${inlineCode("mediaAssets")} document ${inlineCode("_id")} after uploading through the existing CMS media boundary. Do not use the media Worker's external UUID.`,
		"",
		"## Summary",
		"",
		`- Source images: ${assets.length}`,
		`- Mapping values supplied (not yet verified): ${suppliedMappings}`,
		`- Still needing upload or a mapping value: ${assets.length - suppliedMappings}`,
		`- Alt-text review items: ${altText.length}`,
		"",
		"A checked image item means only that a mapping value was supplied. A later authenticated read-only check must confirm that the target media record exists, is ready, and belongs to this site.",
		"",
		"## Image mapping",
		"",
	];

	for (const asset of assets) {
		const targetAssetId = imageAssetMap[asset.sourceAssetRef];
		const sourceUrl = sanityImageSourceUrl(projectId, dataset, asset.sourceAssetRef);
		lines.push(
			`- [${targetAssetId ? "x" : " "}] ${inlineCode(asset.sourceAssetRef)}`,
			`  - Source: ${sourceUrl ? `[open Sanity image](${sourceUrl})` : "unavailable (invalid source reference)"}`,
			`  - Convex media document ID: ${targetAssetId ? inlineCode(targetAssetId) : "blank in the mapping template"}`,
			"  - Placements:",
			...asset.placements
				.slice()
				.sort((a, b) => a.path.localeCompare(b.path))
				.map(
					(placement) =>
						`    - ${inlineCode(placementLabel(placement))} at ${inlineCode(placement.path)}`,
				),
		);
	}

	lines.push("", "## Alt-text review", "");
	for (const item of altText) {
		lines.push(
			`- [ ] ${inlineCode(placementLabel(item))}`,
			`  - Source asset: ${item.sourceAssetRef ? inlineCode(item.sourceAssetRef) : "missing or invalid source reference"}`,
			`  - Source location: ${inlineCode(item.path)}`,
			"  - Factual alt text: _add during the remediation/import step_",
		);
	}

	return {
		imageAssetMap,
		checklistMarkdown: `${lines.join("\n")}\n`,
		counts: {
			assets: assets.length,
			suppliedMappings,
			missingMappingValues: assets.length - suppliedMappings,
			altText: altText.length,
		},
	};
}
