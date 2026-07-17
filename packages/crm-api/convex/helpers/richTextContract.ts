import type { Infer } from "convex/values";
import { v } from "convex/values";

export const RICH_TEXT_SCHEMA_VERSION = 1 as const;

export const RICH_TEXT_LIMITS = {
	blocks: 500,
	listItems: 100,
	spans: 200,
	markDefinitions: 200,
	marksPerSpan: 3,
	keyCharacters: 120,
	spanCharacters: 10_000,
	totalCharacters: 150_000,
	serializedBytes: 512 * 1_024,
	assetIdCharacters: 128,
	altTextCharacters: 500,
	captionCharacters: 2_000,
	urlCharacters: 2_048,
} as const;

export const richTextMarkValidator = v.union(
	v.object({ type: v.literal("strong") }),
	v.object({ type: v.literal("emphasis") }),
	v.object({
		type: v.literal("link"),
		key: v.string(),
		href: v.string(),
	}),
);

export const richTextSpanValidator = v.object({
	type: v.literal("text"),
	key: v.string(),
	text: v.string(),
	marks: v.array(richTextMarkValidator),
});

export const richTextListItemValidator = v.object({
	key: v.string(),
	children: v.array(richTextSpanValidator),
});

/**
 * Schema v1 covers the complete live legacy subset plus the already approved
 * quote and numbered-list semantics. Public page titles retain H1, so body
 * content deliberately starts at H2. Later tools require a schema version,
 * not an unbounded catch-all block.
 */
export const richTextBlockValidator = v.union(
	v.object({
		type: v.literal("paragraph"),
		key: v.string(),
		children: v.array(richTextSpanValidator),
	}),
	v.object({
		type: v.literal("heading"),
		key: v.string(),
		level: v.union(v.literal(2), v.literal(3), v.literal(4)),
		children: v.array(richTextSpanValidator),
	}),
	v.object({
		type: v.literal("quote"),
		key: v.string(),
		children: v.array(richTextSpanValidator),
	}),
	v.object({
		type: v.literal("list"),
		key: v.string(),
		style: v.union(v.literal("bullet"), v.literal("number")),
		items: v.array(richTextListItemValidator),
	}),
	v.object({
		type: v.literal("image"),
		key: v.string(),
		assetId: v.string(),
		altText: v.optional(v.string()),
		caption: v.optional(v.string()),
	}),
);

/**
 * Versioned provider-neutral authoring content. The fixed-depth union excludes
 * HTML, CSS, layout, font, color, spacing, and arbitrary embed payloads.
 */
export const richTextDocumentValidator = v.object({
	version: v.literal(RICH_TEXT_SCHEMA_VERSION),
	blocks: v.array(richTextBlockValidator),
});

export type RichTextDocument = Infer<typeof richTextDocumentValidator>;
export type RichTextBlock = RichTextDocument["blocks"][number];
export type RichTextSpan = Infer<typeof richTextSpanValidator>;
export type RichTextMark = Infer<typeof richTextMarkValidator>;
export type RichTextListItem = Infer<typeof richTextListItemValidator>;

export const RICH_TEXT_ISSUE_CODE = {
	invalidShape: "invalid-shape",
	unsupportedVersion: "unsupported-version",
	unsupportedField: "unsupported-field",
	missingKey: "missing-key",
	invalidKey: "invalid-key",
	duplicateKey: "duplicate-key",
	limitExceeded: "limit-exceeded",
	invalidHeadingLevel: "invalid-heading-level",
	invalidListStyle: "invalid-list-style",
	duplicateMark: "duplicate-mark",
	invalidUrl: "invalid-url",
	missingContent: "missing-content",
	missingImageAlt: "missing-image-alt",
	unsupportedPortableTextNode: "unsupported-portable-text-node",
	unsupportedPortableTextStyle: "unsupported-portable-text-style",
	unsupportedPortableTextMark: "unsupported-portable-text-mark",
	unsupportedPortableTextList: "unsupported-portable-text-list",
	unsupportedPortableTextField: "unsupported-portable-text-field",
	unresolvedImageAsset: "unresolved-image-asset",
} as const;

export type RichTextIssueCode =
	(typeof RICH_TEXT_ISSUE_CODE)[keyof typeof RICH_TEXT_ISSUE_CODE];

export type RichTextIssue = {
	code: RichTextIssueCode;
	path: string;
	message: string;
	severity: "error" | "warning";
};

export type RichTextValidationMode = "draft" | "publish";

export function hasRichTextErrors(issues: readonly RichTextIssue[]) {
	return issues.some((issue) => issue.severity === "error");
}
