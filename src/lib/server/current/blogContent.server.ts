import { error, redirect } from "@sveltejs/kit";
import { ConvexHttpClient } from "convex/browser";
import { api } from "$convex/api";
import {
	BLOG_PRESENTATIONS,
	type BlogAuthor,
	type BlogCategory,
	type BlogImage,
	type BlogPostDetail,
	type BlogPostSummary,
	type BlogPresentation,
	type BlogTechnicalItem,
	type BlogTextBlock,
	type BlogTextMark,
	type BlogTextSpan,
} from "$lib/blog/content";
import { SITE_DOMAIN, SITE_URL } from "$lib/config/site";
import { getConvexUrl } from "$lib/server/runtimeConfig";

const BLOG_LIST_LIMIT = 12;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const KEY = /^[A-Za-z0-9]+(?:[._:-][A-Za-z0-9]+)*$/;
const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MEDIA_ROOT = `https://media.${SITE_DOMAIN}/sites/${SITE_DOMAIN}/web`;
const DERIVATIVES = {
	thumb: { filename: "thumb", width: 320 },
	card: { filename: "card", width: 768 },
	display1280: { filename: "display-1280", width: 1280 },
	display2048: { filename: "display-2048", width: 2048 },
	display2560: { filename: "display-2560", width: 2560 },
} as const;

type Derivative = keyof typeof DERIVATIVES;
type SlugResolution =
	| { status: "current"; kind: "post"; slug: string }
	| { status: "redirect"; kind: "post"; slug: string }
	| null;
type BlogReader = {
	listPublished(signal: AbortSignal): Promise<unknown>;
	getPublishedBySlug(slug: string, signal: AbortSignal): Promise<unknown>;
	resolvePublishedSlug(slug: string, signal: AbortSignal): Promise<unknown>;
};

export class BlogProjectionError extends Error {
	constructor() {
		super("Malformed public Blog projection");
	}
}

function fail(): never {
	throw new BlogProjectionError();
}

function object(
	value: unknown,
	required: readonly string[],
	optional: readonly string[] = [],
): Record<string, unknown> {
	if (!value || typeof value !== "object" || Array.isArray(value)) fail();
	if (Object.getPrototypeOf(value) !== Object.prototype) fail();
	const keys = Reflect.ownKeys(value);
	if (keys.some((key) => typeof key !== "string")) fail();
	const allowed = new Set([...required, ...optional]);
	if (
		required.some((key) => !Object.hasOwn(value, key)) ||
		keys.some((key) => !allowed.has(key as string))
	)
		fail();
	return value as Record<string, unknown>;
}

function list(value: unknown, maximum: number): unknown[] {
	if (!Array.isArray(value) || value.length > maximum) fail();
	return value;
}

function requiredText(value: unknown, maximum: number, pattern?: RegExp): string {
	if (
		typeof value !== "string" ||
		!value ||
		value !== value.trim() ||
		value.length > maximum ||
		(pattern && !pattern.test(value))
	)
		fail();
	return value;
}

function rawText(value: unknown, maximum: number): string {
	if (typeof value !== "string" || value.length > maximum) fail();
	return value;
}

function optionalText(value: unknown, maximum: number): string | null {
	if (value === undefined || value === null || value === "") return null;
	return requiredText(value, maximum);
}

function integer(value: unknown, minimum = 0, maximum = Number.MAX_SAFE_INTEGER): number {
	if (!Number.isSafeInteger(value) || (value as number) < minimum || (value as number) > maximum)
		fail();
	return value as number;
}

function canonicalSlug(value: unknown): string {
	return requiredText(value, 120, SLUG);
}

function key(value: unknown): string {
	return requiredText(value, 120, KEY);
}

function dateFromTimestamp(value: unknown): string {
	return new Date(integer(value, 0, 8_640_000_000_000_000)).toISOString();
}

function presentation(value: unknown): BlogPresentation {
	if (!BLOG_PRESENTATIONS.includes(value as BlogPresentation)) fail();
	return value as BlogPresentation;
}

function safeHref(value: unknown): string {
	const href = requiredText(value, 2_048);
	if ((href.startsWith("/") && !href.startsWith("//")) || href.startsWith("#")) return href;
	let parsed: URL;
	try {
		parsed = new URL(href);
	} catch {
		fail();
	}
	if (!["https:", "http:", "mailto:", "tel:"].includes(parsed.protocol)) fail();
	return href;
}

function fraction(value: unknown): number {
	if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > 1) fail();
	return value;
}

function convexCrop(value: unknown): NonNullable<NonNullable<BlogImage["framing"]>["crop"]> {
	const crop = object(value, ["top", "right", "bottom", "left"]);
	const result = {
		top: fraction(crop.top),
		right: fraction(crop.right),
		bottom: fraction(crop.bottom),
		left: fraction(crop.left),
	};
	if (result.left + result.right >= 1 || result.top + result.bottom >= 1) fail();
	return result;
}

function convexFocus(value: unknown): NonNullable<NonNullable<BlogImage["framing"]>["focus"]> {
	const focus = object(value, ["x", "y", "width", "height"]);
	const result = {
		x: fraction(focus.x),
		y: fraction(focus.y),
		width: fraction(focus.width),
		height: fraction(focus.height),
	};
	if (
		result.width === 0 ||
		result.height === 0 ||
		result.x - result.width / 2 < 0 ||
		result.x + result.width / 2 > 1 ||
		result.y - result.height / 2 < 0 ||
		result.y + result.height / 2 > 1
	)
		fail();
	return result;
}

function convexFraming(value: unknown): BlogImage["framing"] {
	if (value === undefined) return null;
	const framing = object(value, ["crop", "focus"]);
	const crop = framing.crop === null ? null : convexCrop(framing.crop);
	const focus = framing.focus === null ? null : convexFocus(framing.focus);
	if (!crop && !focus) fail();
	if (
		crop &&
		focus &&
		(focus.x - focus.width / 2 < crop.left ||
			focus.x + focus.width / 2 > 1 - crop.right ||
			focus.y - focus.height / 2 < crop.top ||
			focus.y + focus.height / 2 > 1 - crop.bottom)
	)
		fail();
	return { crop, focus };
}

function derivative(value: unknown, name: Derivative, sourceWidth: number, sourceHeight: number) {
	const item = object(value, ["key", "contentType", "width", "height"]);
	if (item.contentType !== "image/webp") fail();
	requiredText(item.key, 500);
	const expectedWidth = Math.min(sourceWidth, DERIVATIVES[name].width);
	const expectedHeight = Math.max(1, Math.round(sourceHeight * (expectedWidth / sourceWidth)));
	const width = integer(item.width, 1, 100_000);
	const height = integer(item.height, 1, 100_000);
	if (width !== expectedWidth || Math.abs(height - expectedHeight) > 1) fail();
	return { width, height };
}

function convexImage(
	value: unknown,
	name: Derivative,
	altValue: unknown,
	captionValue: unknown,
	framing: BlogImage["framing"] = null,
): BlogImage {
	const asset = object(value, ["assetId", "source", "derivatives"]);
	const assetId = requiredText(asset.assetId, 36, UUID_V4);
	const source = object(asset.source, ["width", "height"]);
	const width = integer(source.width, 1, 100_000);
	const height = integer(source.height, 1, 100_000);
	const derivatives = object(asset.derivatives, Object.keys(DERIVATIVES));
	const delivered = Object.fromEntries(
		(Object.keys(DERIVATIVES) as Derivative[]).map((derivativeName) => [
			derivativeName,
			derivative(derivatives[derivativeName], derivativeName, width, height),
		]),
	) as Record<Derivative, { width: number; height: number }>;
	return {
		src: `${MEDIA_ROOT}/${assetId}/${DERIVATIVES[name].filename}.webp`,
		alt: optionalText(altValue, 500) ?? "",
		width: delivered[name].width,
		height: delivered[name].height,
		caption: optionalText(captionValue, 2_000),
		framing,
	};
}

function convexPlacement(value: unknown, name: Derivative, withFraming = false): BlogImage {
	const placement = object(
		value,
		["key", "altText", "asset"],
		withFraming ? ["caption", "framing"] : ["caption"],
	);
	key(placement.key);
	return convexImage(
		placement.asset,
		name,
		placement.altText,
		placement.caption,
		withFraming ? convexFraming(placement.framing) : null,
	);
}

function convexSummaryAuthor(value: unknown): BlogAuthor {
	const author = object(value, ["name", "slug"]);
	requiredText(author.slug, 120, SLUG);
	return { name: requiredText(author.name, 200), image: null };
}

function convexDetailAuthor(value: unknown): BlogAuthor {
	const author = object(value, ["kind", "name", "slug"], ["bio", "portrait"]);
	if (author.kind !== "author") fail();
	requiredText(author.slug, 120, SLUG);
	return {
		name: requiredText(author.name, 200),
		image: author.portrait === undefined ? null : convexPlacement(author.portrait, "thumb", true),
	};
}

function convexCategories(value: unknown, detailed: boolean): BlogCategory[] {
	const seen = new Set<string>();
	return list(value, 20).map((raw) => {
		const category = detailed
			? object(raw, ["kind", "title", "slug"], ["description"])
			: object(raw, ["title", "slug"]);
		if (detailed && category.kind !== "category") fail();
		requiredText(category.slug, 120, SLUG);
		const title = requiredText(category.title, 200);
		if (seen.has(title)) fail();
		seen.add(title);
		return { title };
	});
}

function convexMark(value: unknown): BlogTextMark {
	const candidate = object(value, ["type"], ["key", "href"]);
	if (candidate.type === "strong") {
		if (candidate.key !== undefined || candidate.href !== undefined) fail();
		return { type: "strong" };
	}
	if (candidate.type === "emphasis") {
		if (candidate.key !== undefined || candidate.href !== undefined) fail();
		return { type: "emphasis" };
	}
	if (candidate.type !== "link") fail();
	key(candidate.key);
	return { type: "link", href: safeHref(candidate.href) };
}

function convexSpans(value: unknown): BlogTextSpan[] {
	const seen = new Set<string>();
	return list(value, 200).map((raw) => {
		const span = object(raw, ["type", "key", "text", "marks"]);
		if (span.type !== "text") fail();
		const spanKey = key(span.key);
		if (seen.has(spanKey)) fail();
		seen.add(spanKey);
		const marks = list(span.marks, 3).map(convexMark);
		if (new Set(marks.map(({ type }) => type)).size !== marks.length) fail();
		return { text: rawText(span.text, 10_000), marks };
	});
}

function convexBody(value: unknown): BlogTextBlock[] {
	const document = object(value, ["version", "blocks"]);
	if (document.version !== 1) fail();
	const seen = new Set<string>();
	return list(document.blocks, 500).map<BlogTextBlock>((raw) => {
		const base = object(
			raw,
			["type", "key"],
			["children", "level", "style", "items", "altText", "caption", "asset"],
		);
		const blockKey = key(base.key);
		if (seen.has(blockKey)) fail();
		seen.add(blockKey);
		if (base.type === "paragraph") {
			const block = object(raw, ["type", "key", "children"]);
			return { type: "paragraph", spans: convexSpans(block.children) };
		}
		if (base.type === "quote") {
			const block = object(raw, ["type", "key", "children"]);
			return { type: "quote", spans: convexSpans(block.children) };
		}
		if (base.type === "heading") {
			const block = object(raw, ["type", "key", "level", "children"]);
			if (block.level !== 2 && block.level !== 3 && block.level !== 4) fail();
			return { type: "heading", level: block.level, spans: convexSpans(block.children) };
		}
		if (base.type === "list") {
			const block = object(raw, ["type", "key", "style", "items"]);
			if (block.style !== "bullet" && block.style !== "number") fail();
			const itemKeys = new Set<string>();
			return {
				type: "list",
				level: 1,
				style: block.style,
				items: list(block.items, 100).map((rawItem) => {
					const item = object(rawItem, ["key", "children"]);
					const itemKey = key(item.key);
					if (itemKeys.has(itemKey)) fail();
					itemKeys.add(itemKey);
					return { blockStyle: "normal", spans: convexSpans(item.children), children: [] };
				}),
			};
		}
		if (base.type === "image") {
			const block = object(raw, ["type", "key", "altText", "asset"], ["caption"]);
			return {
				type: "image",
				image: convexImage(block.asset, "display1280", block.altText, block.caption),
			};
		}
		return fail();
	});
}

function convexTechnicalItems(value: unknown): BlogTechnicalItem[] {
	const seen = new Set<string>();
	return list(value, 50).map((raw) => {
		const item = object(raw, ["key"], ["label", "details"]);
		const itemKey = key(item.key);
		if (seen.has(itemKey)) fail();
		seen.add(itemKey);
		const label = optionalText(item.label, 500);
		const details = optionalText(item.details, 2_000);
		if (!label && !details) fail();
		return { kind: "summary", label, details };
	});
}

function convexExcerpt(payload: Record<string, unknown>) {
	const summary = requiredText(payload.summary, 320);
	const excerpt = requiredText(payload.excerpt, 320);
	if (summary !== excerpt) fail();
	return excerpt;
}

function convexSummaryPayload(value: unknown): BlogPostSummary {
	const payload = object(
		value,
		[
			"kind",
			"title",
			"slug",
			"format",
			"presentation",
			"displayPublishedAt",
			"summary",
			"excerpt",
			"author",
			"categories",
		],
		["seoTitle", "seoDescription", "mainImage"],
	);
	if (payload.kind !== "post") fail();
	if (!["essay", "projectStory", "technicalNote"].includes(payload.format as string)) fail();
	return {
		siteUrl: SITE_URL,
		title: requiredText(payload.title, 300),
		slug: canonicalSlug(payload.slug),
		publishedAt: dateFromTimestamp(payload.displayPublishedAt),
		excerpt: convexExcerpt(payload),
		presentation: presentation(payload.presentation),
		author: convexSummaryAuthor(payload.author),
		categories: convexCategories(payload.categories, false),
		mainImage: payload.mainImage === undefined ? null : convexPlacement(payload.mainImage, "card"),
	};
}

export function adaptConvexBlogIndex(value: unknown): BlogPostSummary[] {
	const posts = list(value, BLOG_LIST_LIMIT).map((raw) => {
		const row = object(raw, ["revisionId", "rank", "publishedAt", "payload"]);
		integer(row.rank, 0);
		integer(row.publishedAt, 0);
		return convexSummaryPayload(row.payload);
	});
	if (new Set(posts.map(({ slug }) => slug)).size !== posts.length) fail();
	return posts;
}

export function adaptConvexBlogPost(value: unknown): BlogPostDetail | null {
	if (value === null) return null;
	const row = object(value, ["revisionId", "publishedAt", "payload"]);
	integer(row.publishedAt, 0);
	const payload = object(
		row.payload,
		[
			"kind",
			"title",
			"slug",
			"format",
			"presentation",
			"displayPublishedAt",
			"summary",
			"excerpt",
			"equipment",
			"materials",
			"author",
			"categories",
			"body",
		],
		["seoTitle", "seoDescription", "brief", "approach", "outcome", "credits", "mainImage"],
	);
	if (payload.kind !== "post") fail();
	if (!["essay", "projectStory", "technicalNote"].includes(payload.format as string)) fail();
	const postPresentation = presentation(payload.presentation);
	const mainDerivative = {
		standard: "display1280",
		behindTheScenes: "display2048",
		caseStudy: "display1280",
		clientStory: "display2048",
		technical: "display1280",
	}[postPresentation] as Derivative;
	return {
		siteUrl: SITE_URL,
		title: requiredText(payload.title, 300),
		slug: canonicalSlug(payload.slug),
		publishedAt: dateFromTimestamp(payload.displayPublishedAt),
		excerpt: convexExcerpt(payload),
		presentation: postPresentation,
		author: convexDetailAuthor(payload.author),
		categories: convexCategories(payload.categories, true),
		mainImage:
			payload.mainImage === undefined ? null : convexPlacement(payload.mainImage, mainDerivative),
		seoTitle: optionalText(payload.seoTitle, 300),
		seoDescription: optionalText(payload.seoDescription, 500),
		brief: optionalText(payload.brief, 10_000),
		approach: optionalText(payload.approach, 10_000),
		outcome: optionalText(payload.outcome, 10_000),
		credits: optionalText(payload.credits, 10_000),
		equipment: convexTechnicalItems(payload.equipment),
		materials: convexTechnicalItems(payload.materials),
		body: convexBody(payload.body),
	};
}

function adaptSlugResolution(value: unknown): SlugResolution {
	if (value === null) return null;
	const resolution = object(value, ["status", "kind", "slug"]);
	if (resolution.kind !== "post") fail();
	if (resolution.status !== "current" && resolution.status !== "redirect") fail();
	return {
		status: resolution.status,
		kind: "post",
		slug: canonicalSlug(resolution.slug),
	};
}

function createBlogReader(): BlogReader {
	const request = (signal: AbortSignal) =>
		new ConvexHttpClient(getConvexUrl(), {
			logger: false,
			fetch: (input, init) => fetch(input, { ...init, signal }),
		});
	return {
		listPublished: (signal) =>
			request(signal).query(api.postContent.listPublished, {
				siteUrl: SITE_DOMAIN,
				limit: BLOG_LIST_LIMIT,
			}),
		getPublishedBySlug: (slug, signal) =>
			request(signal).query(api.postContent.getPublishedBySlug, {
				siteUrl: SITE_DOMAIN,
				slug,
			}),
		resolvePublishedSlug: (slug, signal) =>
			request(signal).query(api.postContent.resolvePublishedSlug, {
				siteUrl: SITE_DOMAIN,
				slug,
			}),
	};
}

function unavailable(): never {
	throw error(503, "Blog is unavailable");
}

function notFound(): never {
	throw error(404, "Post not found");
}

export function createBlogContentProvider(dependencies: { createReader?: () => BlogReader } = {}) {
	const reader = dependencies.createReader ?? createBlogReader;

	async function convexIndex(signal: AbortSignal) {
		return adaptConvexBlogIndex(await reader().listPublished(signal));
	}

	async function convexPost(slug: string, signal: AbortSignal) {
		const post = adaptConvexBlogPost(await reader().getPublishedBySlug(slug, signal));
		if (post) return { post, resolution: null };
		const resolution = adaptSlugResolution(await reader().resolvePublishedSlug(slug, signal));
		return { post: null, resolution };
	}

	async function loadConvexIndex() {
		try {
			return await convexIndex(AbortSignal.timeout(6_000));
		} catch {
			unavailable();
		}
	}

	async function loadConvexPost(slug: string) {
		let result: Awaited<ReturnType<typeof convexPost>>;
		try {
			result = await convexPost(slug, AbortSignal.timeout(6_000));
		} catch {
			unavailable();
		}
		if (result.post) return result.post;
		if (result.resolution?.status === "redirect") {
			if (result.resolution.slug === slug) unavailable();
			redirect(308, `/blog/${result.resolution.slug}`);
		}
		if (result.resolution?.status === "current") unavailable();
		notFound();
	}

	return {
		async loadIndex() {
			return await loadConvexIndex();
		},
		async loadPost(slugValue: string) {
			let slug: string;
			try {
				slug = canonicalSlug(slugValue);
			} catch {
				notFound();
			}
			return await loadConvexPost(slug);
		},
	};
}

export const blogContent = createBlogContentProvider();
