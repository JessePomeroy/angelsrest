import type { RichTextDocument, RichTextIssue } from "./richTextContract";
import { convertPortableText } from "./portableTextAdapter";
import {
	inspectRichTextDocument,
	richTextToPlainText,
} from "./richTextValidation";
import {
	authorSlugCandidate,
	categorySlugCandidate,
	type AuthorDraft,
	type CategoryDraft,
} from "./blogContentValidators";
import {
	POST_CONTENT_LIMITS,
	postSlugCandidate,
	type PostDraft,
	type PostFormat,
	type PostPresentation,
	type PostTechnicalItem,
} from "./postContentValidators";

export type SanityImportIssue = {
	code:
		| "duplicate-source-id"
		| "generated-category-slug"
		| "generated-summary"
		| "invalid-reference"
		| "missing-exported-reference"
		| "missing-image-alt"
		| "missing-required-field"
		| "portable-text"
		| "slug-collision";
	path: string;
	message: string;
	severity: "error" | "warning";
};

type SanityReference = {
	_ref?: unknown;
	_type?: unknown;
};

type SanitySlug = {
	current?: unknown;
};

type SanityImage = {
	_key?: unknown;
	asset?: SanityReference;
	alt?: unknown;
	caption?: unknown;
};

export type SanityAuthorSource = {
	_id: string;
	_type?: "author";
	name?: unknown;
	slug?: SanitySlug;
	bio?: unknown;
	image?: SanityImage;
};

export type SanityCategorySource = {
	_id: string;
	_type?: "category";
	title?: unknown;
	description?: unknown;
};

export type SanityGearItemSource = {
	_key?: unknown;
	camera?: unknown;
	lens?: unknown;
	filmStock?: unknown;
	developer?: unknown;
};

export type SanityPostSource = {
	_id: string;
	_type?: "post";
	title?: unknown;
	postType?: unknown;
	slug?: SanitySlug;
	author?: SanityReference;
	mainImage?: SanityImage;
	categories?: SanityReference[];
	publishedAt?: unknown;
	brief?: unknown;
	approach?: unknown;
	result?: unknown;
	gearUsed?: SanityGearItemSource[];
	body?: unknown;
};

export type SanityBlogImportSource = {
	authors: SanityAuthorSource[];
	categories: SanityCategorySource[];
	posts: SanityPostSource[];
};

export type SanityBlogImportAuthor = {
	sourceId: string;
	documentKey: string;
	draft: SanityBlogImportAuthorDraft;
	issues: SanityImportIssue[];
};

export type SanityBlogImportAuthorDraft = Omit<AuthorDraft, "portrait"> & {
	portrait?: {
		key: string;
		sourceAssetRef: string;
		altText?: string;
		caption?: string;
	};
};

export type SanityBlogImportCategory = {
	sourceId: string;
	documentKey: string;
	draft: CategoryDraft;
	issues: SanityImportIssue[];
};

export type SanityBlogImportPost = {
	sourceId: string;
	documentKey: string;
	bodySourceAssetRefs: string[];
	draft: Omit<PostDraft, "authorDocumentId" | "categories" | "mainImage"> & {
		authorDocumentKey?: string;
		categories: Array<{ key: string; documentKey: string }>;
		mainImage?: {
			key: string;
			sourceAssetRef: string;
			altText?: string;
			caption?: string;
		};
		body: RichTextDocument;
	};
	issues: SanityImportIssue[];
};

export type SanityBlogImportManifest = {
	version: 1;
	authors: SanityBlogImportAuthor[];
	categories: SanityBlogImportCategory[];
	posts: SanityBlogImportPost[];
	issues: SanityImportIssue[];
};

export type SanityBlogImportDryRunStatus =
	| "ready"
	| "ready-with-warnings"
	| "blocked";

export type SanityBlogImportDryRunReport = {
	version: 1;
	status: SanityBlogImportDryRunStatus;
	counts: {
		authors: number;
		categories: number;
		posts: number;
		requiredSourceAssets: number;
		errors: number;
		warnings: number;
	};
	requiredSourceAssetRefs: string[];
	blockingIssues: SanityImportIssue[];
	warningIssues: SanityImportIssue[];
	issues: SanityImportIssue[];
};

export type SanityBlogImportOptions = {
	imageAssetIds?: Readonly<Record<string, string>>;
};

const EMPTY_RICH_TEXT: RichTextDocument = { version: 1, blocks: [] };

function issue(
	code: SanityImportIssue["code"],
	path: string,
	message: string,
	severity: SanityImportIssue["severity"] = "error",
): SanityImportIssue {
	return { code, path, message, severity };
}

function portableIssues(
	path: string,
	issues: readonly RichTextIssue[],
): SanityImportIssue[] {
	return issues.map((portableIssue) => ({
		code: "portable-text" as const,
		path: `${path}${portableIssue.path}`,
		message: portableIssue.message,
		severity: portableIssue.severity,
	}));
}

function cleanSourceId(value: string) {
	return value.replace(/^drafts\./, "");
}

function documentKey(kind: "author" | "category" | "post", sourceId: string) {
	return `sanity.${kind}.${cleanSourceId(sourceId)}`;
}

function text(value: unknown) {
	return typeof value === "string" ? value.trim() : undefined;
}

function slugCurrent(value: SanitySlug | undefined) {
	return text(value?.current);
}

function sourceReference(value: SanityReference | undefined) {
	const ref = text(value?._ref);
	return ref ? cleanSourceId(ref) : undefined;
}

function imageSourceRef(value: SanityImage | undefined) {
	const ref = sourceReference(value?.asset);
	return ref?.startsWith("image-") ? ref : undefined;
}

function bodySourceAssetRefs(value: unknown) {
	if (!Array.isArray(value)) return [];
	const refs = new Set<string>();
	for (const node of value) {
		if (
			typeof node !== "object"
			|| node === null
			|| !("_type" in node)
			|| node._type !== "image"
		) continue;
		const ref = imageSourceRef(node as SanityImage);
		if (ref) refs.add(ref);
	}
	return Array.from(refs).sort();
}

function timestamp(value: unknown) {
	if (typeof value !== "string") return undefined;
	const time = Date.parse(value);
	return Number.isSafeInteger(time) ? time : undefined;
}

function truncate(value: string, maximum: number) {
	return value.length <= maximum ? value : value.slice(0, maximum).trimEnd();
}

function generatedSummary(body: RichTextDocument) {
	const plainText = richTextToPlainText(body).replace(/\s+/g, " ").trim();
	return truncate(plainText, POST_CONTENT_LIMITS.summary);
}

function postTypeMapping(postType: unknown): {
	format: PostFormat;
	presentation: PostPresentation;
} {
	if (postType === "caseStudy") {
		return { format: "projectStory", presentation: "caseStudy" };
	}
	if (postType === "clientStory") {
		return { format: "projectStory", presentation: "clientStory" };
	}
	if (postType === "technical") {
		return { format: "technicalNote", presentation: "technical" };
	}
	if (postType === "behindTheScenes") {
		return { format: "essay", presentation: "behindTheScenes" };
	}
	return { format: "essay", presentation: "standard" };
}

function gearItem(
	item: SanityGearItemSource,
	index: number,
): PostTechnicalItem | null {
	const parts = [
		text(item.camera),
		text(item.lens),
		text(item.filmStock),
		text(item.developer),
	].filter((part): part is string => Boolean(part));
	if (parts.length === 0) return null;
	const key = text(item._key) ?? `gear-${index + 1}`;
	return {
		key,
		label: parts.slice(0, 2).join(" · ") || parts[0],
		details: parts.join(" · "),
	};
}

function convertAuthor(
	source: SanityAuthorSource,
	index: number,
	options: SanityBlogImportOptions,
): SanityBlogImportAuthor {
	const path = `$.authors[${index}]`;
	const sourceId = cleanSourceId(source._id);
	const issues: SanityImportIssue[] = [];
	const convertedBio = source.bio === undefined
		? { document: undefined, issues: [] as RichTextIssue[] }
		: convertPortableText(source.bio, {
			imageAssetIds: options.imageAssetIds ?? {},
			mode: "draft",
		});
	issues.push(...portableIssues(`${path}.bio`, convertedBio.issues));
	const name = text(source.name);
	if (!name) {
		issues.push(issue("missing-required-field", `${path}.name`, "Author name is required"));
	}
	const slug = slugCurrent(source.slug) ?? (name ? authorSlugCandidate(name) : undefined);
	const portraitRef = imageSourceRef(source.image);
	const draft: SanityBlogImportAuthorDraft = {
		kind: "author",
		...(name ? { name } : {}),
		...(slug ? { slug } : {}),
		...(convertedBio.document && convertedBio.document.blocks.length > 0
			? { bio: convertedBio.document }
			: {}),
		...(portraitRef
			? {
				portrait: {
					key: text(source.image?._key) ?? "portrait",
					sourceAssetRef: portraitRef,
					...(text(source.image?.alt) ? { altText: text(source.image?.alt) } : {}),
					...(text(source.image?.caption) ? { caption: text(source.image?.caption) } : {}),
				},
			}
			: {}),
	};
	return { sourceId, documentKey: documentKey("author", sourceId), draft, issues };
}

function convertCategory(
	source: SanityCategorySource,
	index: number,
): SanityBlogImportCategory {
	const path = `$.categories[${index}]`;
	const sourceId = cleanSourceId(source._id);
	const issues: SanityImportIssue[] = [];
	const title = text(source.title);
	if (!title) {
		issues.push(issue("missing-required-field", `${path}.title`, "Category title is required"));
	}
	const slug = title ? categorySlugCandidate(title) : undefined;
	if (slug) {
		issues.push(
			issue(
				"generated-category-slug",
				`${path}.title`,
				"Sanity categories have no slug field; generated one from the title",
				"warning",
			),
		);
	}
	const description = text(source.description);
	return {
		sourceId,
		documentKey: documentKey("category", sourceId),
		draft: {
			kind: "category",
			...(title ? { title } : {}),
			...(slug ? { slug } : {}),
			...(description ? { description } : {}),
		},
		issues,
	};
}

function convertPost(
	source: SanityPostSource,
	index: number,
	options: SanityBlogImportOptions,
): SanityBlogImportPost {
	const path = `$.posts[${index}]`;
	const sourceId = cleanSourceId(source._id);
	const issues: SanityImportIssue[] = [];
	const body = convertPortableText(source.body ?? [], {
		imageAssetIds: options.imageAssetIds ?? {},
		mode: "draft",
	});
	issues.push(...portableIssues(`${path}.body`, body.issues));
	const document = body.document ?? EMPTY_RICH_TEXT;
	const title = text(source.title);
	if (!title) {
		issues.push(issue("missing-required-field", `${path}.title`, "Post title is required"));
	}
	const slug = slugCurrent(source.slug) ?? (title ? postSlugCandidate(title) : undefined);
	const summary = generatedSummary(document);
	if (!summary) {
		issues.push(issue("missing-required-field", `${path}.body`, "Post summary could not be generated"));
	} else {
		issues.push(
			issue(
				"generated-summary",
				`${path}.body`,
				"Sanity posts derive excerpts from body text; generated the CMS summary from body text",
				"warning",
			),
		);
	}
	const authorSourceId = sourceReference(source.author);
	if (!authorSourceId) {
		issues.push(issue("invalid-reference", `${path}.author`, "Post author reference is required"));
	}
	const categories = (source.categories ?? [])
		.map((category, categoryIndex) => {
			const categorySourceId = sourceReference(category);
			if (!categorySourceId) {
				issues.push(
					issue(
						"invalid-reference",
						`${path}.categories[${categoryIndex}]`,
						"Category reference must point at a Sanity category document",
					),
				);
				return null;
			}
			return {
				key: `category-${categoryIndex + 1}`,
				documentKey: documentKey("category", categorySourceId),
			};
		})
		.filter((category): category is { key: string; documentKey: string } => Boolean(category));
	const mainImageRef = imageSourceRef(source.mainImage);
	const mapping = postTypeMapping(source.postType);
	const equipment = (source.gearUsed ?? [])
		.map((item, itemIndex) => gearItem(item, itemIndex))
		.filter((item): item is PostTechnicalItem => Boolean(item));
	return {
		sourceId,
		documentKey: documentKey("post", sourceId),
		bodySourceAssetRefs: bodySourceAssetRefs(source.body),
		draft: {
			kind: "post",
			...(title ? { title } : {}),
			...(slug ? { slug } : {}),
			...mapping,
			...(timestamp(source.publishedAt) ? { displayPublishedAt: timestamp(source.publishedAt) } : {}),
			...(summary ? { summary } : {}),
			...(text(source.brief) ? { brief: text(source.brief) } : {}),
			...(text(source.approach) ? { approach: text(source.approach) } : {}),
			...(text(source.result) ? { outcome: text(source.result) } : {}),
			equipment,
			materials: [],
			...(authorSourceId ? { authorDocumentKey: documentKey("author", authorSourceId) } : {}),
			categories,
			...(mainImageRef
				? {
					mainImage: {
						key: text(source.mainImage?._key) ?? "main-image",
						sourceAssetRef: mainImageRef,
						...(text(source.mainImage?.alt) ? { altText: text(source.mainImage?.alt) } : {}),
						...(text(source.mainImage?.caption) ? { caption: text(source.mainImage?.caption) } : {}),
					},
				}
				: {}),
			body: document,
		},
		issues,
	};
}

function duplicateSourceIssues(
	kind: "authors" | "categories" | "posts",
	sources: Array<{ _id: string }>,
) {
	const seen = new Set<string>();
	const issues: SanityImportIssue[] = [];
	for (const [index, source] of sources.entries()) {
		const sourceId = cleanSourceId(source._id);
		if (seen.has(sourceId)) {
			issues.push(
				issue(
					"duplicate-source-id",
					`$.${kind}[${index}]._id`,
					`Duplicate Sanity source id "${sourceId}"`,
				),
			);
		}
		seen.add(sourceId);
	}
	return issues;
}

export function createSanityBlogImportManifest(
	source: SanityBlogImportSource,
	options: SanityBlogImportOptions = {},
): SanityBlogImportManifest {
	const authors = source.authors.map((author, index) =>
		convertAuthor(author, index, options),
	);
	const categories = source.categories.map((category, index) =>
		convertCategory(category, index),
	);
	const posts = source.posts.map((post, index) =>
		convertPost(post, index, options),
	);
	const issues = [
		...duplicateSourceIssues("authors", source.authors),
		...duplicateSourceIssues("categories", source.categories),
		...duplicateSourceIssues("posts", source.posts),
		...authors.flatMap((author) => author.issues),
		...categories.flatMap((category) => category.issues),
		...posts.flatMap((post) => post.issues),
	];
	return { version: 1, authors, categories, posts, issues };
}

function requiredSourceAssetRefs(manifest: SanityBlogImportManifest) {
	const refs = new Set<string>();
	for (const author of manifest.authors) {
		if (author.draft.portrait?.sourceAssetRef) {
			refs.add(author.draft.portrait.sourceAssetRef);
		}
	}
	for (const post of manifest.posts) {
		if (post.draft.mainImage?.sourceAssetRef) {
			refs.add(post.draft.mainImage.sourceAssetRef);
		}
		for (const bodyRef of post.bodySourceAssetRefs) {
			refs.add(bodyRef);
		}
	}
	return Array.from(refs).sort();
}

function missingExportedReferenceIssues(
	manifest: SanityBlogImportManifest,
): SanityImportIssue[] {
	const authorKeys = new Set(manifest.authors.map((author) => author.documentKey));
	const categoryKeys = new Set(
		manifest.categories.map((category) => category.documentKey),
	);
	const issues: SanityImportIssue[] = [];
	for (const [postIndex, post] of manifest.posts.entries()) {
		if (
			post.draft.authorDocumentKey
			&& !authorKeys.has(post.draft.authorDocumentKey)
		) {
			issues.push(
				issue(
					"missing-exported-reference",
					`$.posts[${postIndex}].draft.authorDocumentKey`,
					`Post author "${post.draft.authorDocumentKey}" is not present in this export`,
				),
			);
		}
		for (const [categoryIndex, category] of post.draft.categories.entries()) {
			if (!categoryKeys.has(category.documentKey)) {
				issues.push(
					issue(
						"missing-exported-reference",
						`$.posts[${postIndex}].draft.categories[${categoryIndex}].documentKey`,
						`Post category "${category.documentKey}" is not present in this export`,
					),
				);
			}
		}
	}
	return issues;
}

function slugCollisionIssues(
	kind: "authors" | "categories" | "posts",
	items: Array<{ draft: { slug?: string } }>,
): SanityImportIssue[] {
	const seen = new Map<string, number>();
	const issues: SanityImportIssue[] = [];
	for (const [index, item] of items.entries()) {
		const slug = item.draft.slug;
		if (!slug) continue;
		const firstIndex = seen.get(slug);
		if (firstIndex !== undefined) {
			issues.push(
				issue(
					"slug-collision",
					`$.${kind}[${index}].draft.slug`,
					`${kind} slug "${slug}" also appears at $.${kind}[${firstIndex}].draft.slug`,
				),
			);
			continue;
		}
		seen.set(slug, index);
	}
	return issues;
}

function missingPublishImageAltIssues(
	manifest: SanityBlogImportManifest,
): SanityImportIssue[] {
	const issues: SanityImportIssue[] = [];
	for (const [authorIndex, author] of manifest.authors.entries()) {
		if (author.draft.portrait && !author.draft.portrait.altText?.trim()) {
			issues.push(
				issue(
					"missing-image-alt",
					`$.authors[${authorIndex}].draft.portrait.altText`,
					"Author portrait needs factual alt text before import publication",
				),
			);
		}
	}
	for (const [postIndex, post] of manifest.posts.entries()) {
		if (post.draft.mainImage && !post.draft.mainImage.altText?.trim()) {
			issues.push(
				issue(
					"missing-image-alt",
					`$.posts[${postIndex}].draft.mainImage.altText`,
					"Post main image needs factual alt text before import publication",
				),
			);
		}
		const body = inspectRichTextDocument(post.draft.body, "publish");
		issues.push(
			...body.issues
				.filter((bodyIssue) => bodyIssue.severity === "error")
				.map((bodyIssue) =>
					issue(
						bodyIssue.code === "missing-image-alt"
							? "missing-image-alt"
							: "portable-text",
						`$.posts[${postIndex}].draft.body${bodyIssue.path.slice(1)}`,
						bodyIssue.message,
					),
				),
		);
	}
	return issues;
}

export function createSanityBlogImportDryRunReport(
	manifest: SanityBlogImportManifest,
): SanityBlogImportDryRunReport {
	const dryRunIssues = [
		...missingExportedReferenceIssues(manifest),
		...slugCollisionIssues("authors", manifest.authors),
		...slugCollisionIssues("categories", manifest.categories),
		...slugCollisionIssues("posts", manifest.posts),
		...missingPublishImageAltIssues(manifest),
	];
	const issues = [...manifest.issues, ...dryRunIssues];
	const blockingIssues = issues.filter((reportIssue) => reportIssue.severity === "error");
	const warningIssues = issues.filter((reportIssue) => reportIssue.severity === "warning");
	const sourceAssetRefs = requiredSourceAssetRefs(manifest);
	const status: SanityBlogImportDryRunStatus = blockingIssues.length > 0
		? "blocked"
		: warningIssues.length > 0
			? "ready-with-warnings"
			: "ready";
	return {
		version: 1,
		status,
		counts: {
			authors: manifest.authors.length,
			categories: manifest.categories.length,
			posts: manifest.posts.length,
			requiredSourceAssets: sourceAssetRefs.length,
			errors: blockingIssues.length,
			warnings: warningIssues.length,
		},
		requiredSourceAssetRefs: sourceAssetRefs,
		blockingIssues,
		warningIssues,
		issues,
	};
}
