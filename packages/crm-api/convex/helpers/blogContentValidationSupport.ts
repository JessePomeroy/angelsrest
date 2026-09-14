import type { RichTextDocument } from "./richTextContract";
import {
	inspectRichTextDocument,
	richTextToPlainText,
} from "./richTextValidation";

export const BLOG_CONTENT_LIMITS = {
	authorName: 120,
	authorSlug: 96,
	authorBioBlocks: 50,
	authorBioCharacters: 20_000,
	authorBioSerializedBytes: 32 * 1_024,
	categoryTitle: 120,
	categorySlug: 96,
	categoryDescription: 2_000,
	portraitKey: 120,
	portraitAltText: 500,
	portraitCaption: 2_000,
} as const;

const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEMENT_KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;

export type BlogImageCrop = {
	top: number;
	right: number;
	bottom: number;
	left: number;
};

export type BlogImageFocus = {
	x: number;
	y: number;
	width: number;
	height: number;
};

export type BlogImageFraming = {
	crop: BlogImageCrop | null;
	focus: BlogImageFocus | null;
};

export function assertOnlyKeys(
	value: object,
	allowed: ReadonlySet<string>,
	label: string,
) {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			throw new Error(`${label} contains unsupported field "${key}"`);
		}
	}
}

export function assertMaximum(
	value: string | undefined,
	maximum: number,
	field: string,
) {
	if (value !== undefined && value.length > maximum) {
		throw new Error(`${field} must be ${maximum} characters or fewer`);
	}
}

function assertRequiredKeys(
	value: object,
	required: ReadonlySet<string>,
	label: string,
) {
	for (const key of required) {
		if (!Object.prototype.hasOwnProperty.call(value, key)) {
			throw new Error(`${label} is missing required field "${key}"`);
		}
	}
}

function requireUnitFraction(value: unknown, label: string) {
	if (
		typeof value !== "number"
		|| !Number.isFinite(value)
		|| value < 0
		|| value > 1
	) throw new Error(`${label} must be a finite fraction from 0 through 1`);
	return value;
}

export function validateBlogImageCrop(
	crop: BlogImageCrop,
	label = "Author portrait framing crop",
) {
	const keys = new Set(["top", "right", "bottom", "left"]);
	assertOnlyKeys(crop, keys, label);
	assertRequiredKeys(crop, keys, label);
	const top = requireUnitFraction(crop.top, `${label}.top`);
	const right = requireUnitFraction(crop.right, `${label}.right`);
	const bottom = requireUnitFraction(crop.bottom, `${label}.bottom`);
	const left = requireUnitFraction(crop.left, `${label}.left`);
	if (left + right >= 1 || top + bottom >= 1) {
		throw new Error(`${label} must leave positive width and height`);
	}
	return { top, right, bottom, left };
}

export function validateBlogImageFocus(
	focus: BlogImageFocus,
	label = "Author portrait framing focus",
) {
	const keys = new Set(["x", "y", "width", "height"]);
	assertOnlyKeys(focus, keys, label);
	assertRequiredKeys(focus, keys, label);
	const x = requireUnitFraction(focus.x, `${label}.x`);
	const y = requireUnitFraction(focus.y, `${label}.y`);
	const width = requireUnitFraction(focus.width, `${label}.width`);
	const height = requireUnitFraction(focus.height, `${label}.height`);
	if (width <= 0 || height <= 0) {
		throw new Error(`${label} width and height must be positive`);
	}
	if (
		x - width / 2 < 0
		|| x + width / 2 > 1
		|| y - height / 2 < 0
		|| y + height / 2 > 1
	) throw new Error(`${label} rectangle must remain inside the image`);
	return { x, y, width, height };
}

export function validateBlogImageFraming(
	framing: BlogImageFraming,
	label = "Author portrait framing",
) {
	const keys = new Set(["crop", "focus"]);
	assertOnlyKeys(framing, keys, label);
	assertRequiredKeys(framing, keys, label);
	if (framing.crop === null && framing.focus === null) {
		throw new Error(`${label} must contain crop or focus data`);
	}
	const crop = framing.crop === null
		? null
		: validateBlogImageCrop(framing.crop, `${label}.crop`);
	const focus = framing.focus === null
		? null
		: validateBlogImageFocus(framing.focus, `${label}.focus`);
	if (
		crop
		&& focus
		&& (
			focus.x - focus.width / 2 < crop.left
			|| focus.x + focus.width / 2 > 1 - crop.right
			|| focus.y - focus.height / 2 < crop.top
			|| focus.y + focus.height / 2 > 1 - crop.bottom
		)
	) throw new Error(`${label} focus rectangle must remain inside the surviving crop`);
	return { crop, focus };
}

function richTextIssueSummary(
	issues: ReturnType<typeof inspectRichTextDocument>["issues"],
) {
	return issues
		.filter((issue) => issue.severity === "error")
		.map((issue) => `${issue.path}: ${issue.message}`)
		.join("; ");
}

export function inspectTextOnlyBio(
	value: RichTextDocument,
	mode: "draft" | "publish",
) {
	// A zero-block biography is intentionally equivalent to no biography at
	// publication. Draft inspection still verifies its exact schema-v1 shape.
	const inspectionMode = mode === "publish" && value.blocks.length === 0
		? "draft"
		: mode;
	const inspection = inspectRichTextDocument(value, inspectionMode);
	if (inspection.document === null) {
		throw new Error(
			`Author biography is invalid: ${richTextIssueSummary(inspection.issues)}`,
		);
	}
	if (inspection.document.blocks.some((block) => block.type === "image")) {
		throw new Error("Author biography cannot contain image blocks");
	}
	if (inspection.document.blocks.length > BLOG_CONTENT_LIMITS.authorBioBlocks) {
		throw new Error(
			`Author biography cannot contain more than ${BLOG_CONTENT_LIMITS.authorBioBlocks} blocks`,
		);
	}
	if (
		richTextToPlainText(inspection.document).length
		> BLOG_CONTENT_LIMITS.authorBioCharacters
	) {
		throw new Error(
			`Author biography cannot contain more than ${BLOG_CONTENT_LIMITS.authorBioCharacters} projected text characters`,
		);
	}
	const serializedBytes = new TextEncoder().encode(
		JSON.stringify(value),
	).byteLength;
	if (serializedBytes > BLOG_CONTENT_LIMITS.authorBioSerializedBytes) {
		throw new Error(
			`Author biography cannot exceed ${BLOG_CONTENT_LIMITS.authorBioSerializedBytes} serialized bytes`,
		);
	}
	return inspection.document;
}

export function validatePortraitDraft(portrait: {
	key: string;
	assetId: string;
	altText?: string;
	caption?: string;
	framing?: BlogImageFraming;
}) {
	assertOnlyKeys(
		portrait,
		new Set(["key", "assetId", "altText", "caption", "framing"]),
		"Author portrait",
	);
	assertMaximum(
		portrait.key,
		BLOG_CONTENT_LIMITS.portraitKey,
		"Author portrait key",
	);
	if (
		portrait.key !== portrait.key.trim()
		|| !PLACEMENT_KEY_PATTERN.test(portrait.key)
	) {
		throw new Error(
			"Author portrait key must be normalized letters, numbers, dot, underscore, colon, or hyphen",
		);
	}
	assertMaximum(
		portrait.altText,
		BLOG_CONTENT_LIMITS.portraitAltText,
		"Author portrait alt text",
	);
	assertMaximum(
		portrait.caption,
		BLOG_CONTENT_LIMITS.portraitCaption,
		"Author portrait caption",
	);
	if (portrait.framing !== undefined) {
		validateBlogImageFraming(portrait.framing);
	}
}

export function requireText(
	value: string | undefined,
	field: string,
	maximum: number,
) {
	const normalized = value?.trim() ?? "";
	if (!normalized) throw new Error(`${field} is required before publishing`);
	assertMaximum(normalized, maximum, field);
	return normalized;
}

export function optionalText(
	value: string | undefined,
	field: string,
	maximum: number,
) {
	const normalized = value?.trim();
	if (!normalized) return undefined;
	assertMaximum(normalized, maximum, field);
	return normalized;
}

export function requireCanonicalBlogSlug(
	value: string | undefined,
	field: "Author slug" | "Category slug",
	maximum: number,
) {
	const slug = requireText(value, field, maximum);
	if (slug !== value || !SLUG_PATTERN.test(slug)) {
		throw new Error(
			`${field} must use normalized lowercase words separated by hyphens`,
		);
	}
	return slug;
}

/**
 * Suggest a normalized supporting-document slug without claiming uniqueness.
 * The write path remains responsible for checking the tenant-scoped kind/slug
 * index before publication.
 */
export function blogSlugCandidate(
	label: string,
	maximum = BLOG_CONTENT_LIMITS.authorSlug,
) {
	const candidate = label
		.normalize("NFKD")
		.replace(/[\u0300-\u036f]/g, "")
		.toLowerCase()
		.replace(/[\u2018\u2019']/g, "")
		.replace(/[^a-z0-9]+/g, "-")
		.replace(/^-+|-+$/g, "")
		.slice(0, maximum);
	return candidate.replace(/-+$/g, "");
}

export function authorSlugCandidate(name: string) {
	return blogSlugCandidate(name, BLOG_CONTENT_LIMITS.authorSlug);
}

export function categorySlugCandidate(title: string) {
	return blogSlugCandidate(title, BLOG_CONTENT_LIMITS.categorySlug);
}
