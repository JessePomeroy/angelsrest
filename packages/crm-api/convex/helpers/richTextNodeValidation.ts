import {
	RICH_TEXT_ISSUE_CODE,
	RICH_TEXT_LIMITS,
	type RichTextBlock,
	type RichTextListItem,
	type RichTextMark,
	type RichTextSpan,
} from "./richTextContract";
import {
	addIssue,
	addMissingContentIssue,
	assertOnlyKeys,
	assertUniqueKeys,
	isRecord,
	isSafeRichTextUrl,
	readBoundedString,
	readKey,
	readOptionalBoundedString,
	sortRichTextMarks,
	spansToText,
	type ValidationContext,
} from "./richTextValidationSupport";

function normalizeMark(
	value: unknown,
	path: string,
	ctx: ValidationContext,
): RichTextMark | null {
	if (!isRecord(value) || typeof value.type !== "string") {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.invalidShape, path, "Expected a text mark");
		return null;
	}
	if (value.type === "strong" || value.type === "emphasis") {
		assertOnlyKeys(value, new Set(["type"]), path, ctx);
		return { type: value.type };
	}
	if (value.type === "link") {
		assertOnlyKeys(value, new Set(["type", "key", "href"]), path, ctx);
		const key = readKey(value.key, `${path}.key`, ctx);
		const href = readBoundedString(
			value.href,
			`${path}.href`,
			RICH_TEXT_LIMITS.urlCharacters,
			ctx,
		);
		if (href !== null && !isSafeRichTextUrl(href)) {
			addIssue(
				ctx,
				RICH_TEXT_ISSUE_CODE.invalidUrl,
				`${path}.href`,
				"Links must use a safe web, email, telephone, root-relative, or fragment URL",
			);
		}
		return key !== null && href !== null
			? { type: "link", key, href: href.trim() }
			: null;
	}
	addIssue(
		ctx,
		RICH_TEXT_ISSUE_CODE.invalidShape,
		`${path}.type`,
		`Unsupported rich-text mark "${value.type}"`,
	);
	return null;
}

function normalizeSpan(
	value: unknown,
	path: string,
	ctx: ValidationContext,
): RichTextSpan | null {
	if (!isRecord(value) || value.type !== "text") {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.invalidShape, path, "Expected a text span");
		return null;
	}
	assertOnlyKeys(value, new Set(["type", "key", "text", "marks"]), path, ctx);
	const key = readKey(value.key, `${path}.key`, ctx);
	const text = readBoundedString(
		value.text,
		`${path}.text`,
		RICH_TEXT_LIMITS.spanCharacters,
		ctx,
	);
	if (!Array.isArray(value.marks)) {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.invalidShape, `${path}.marks`, "Expected marks");
		return null;
	}
	if (value.marks.length > RICH_TEXT_LIMITS.marksPerSpan) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.limitExceeded,
			`${path}.marks`,
			`A text span cannot contain more than ${RICH_TEXT_LIMITS.marksPerSpan} marks`,
		);
	}
	const marks = sortRichTextMarks(
		value.marks
			.map((mark, index) => normalizeMark(mark, `${path}.marks[${index}]`, ctx))
			.filter((mark): mark is RichTextMark => mark !== null),
	);
	const markKinds = marks.map((mark) => mark.type);
	if (new Set(markKinds).size !== markKinds.length) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.duplicateMark,
			`${path}.marks`,
			"A text span cannot repeat the same mark type",
		);
	}
	return key !== null && text !== null ? { type: "text", key, text, marks } : null;
}

function normalizeSpans(
	value: unknown,
	path: string,
	ctx: ValidationContext,
): RichTextSpan[] | null {
	if (!Array.isArray(value)) {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.invalidShape, path, "Expected text spans");
		return null;
	}
	if (value.length > RICH_TEXT_LIMITS.spans) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.limitExceeded,
			path,
			`A text block cannot contain more than ${RICH_TEXT_LIMITS.spans} spans`,
		);
	}
	const spans = value
		.map((span, index) => normalizeSpan(span, `${path}[${index}]`, ctx))
		.filter((span): span is RichTextSpan => span !== null);
	assertUniqueKeys(spans.map((span) => span.key), path, ctx);
	return spans;
}

function normalizeListItem(
	value: unknown,
	path: string,
	ctx: ValidationContext,
): RichTextListItem | null {
	if (!isRecord(value)) {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.invalidShape, path, "Expected a list item");
		return null;
	}
	assertOnlyKeys(value, new Set(["key", "children"]), path, ctx);
	const key = readKey(value.key, `${path}.key`, ctx);
	const children = normalizeSpans(value.children, `${path}.children`, ctx);
	return key !== null && children !== null ? { key, children } : null;
}

function normalizeTextBlock(
	value: Record<string, unknown>,
	type: "paragraph" | "quote",
	key: string | null,
	path: string,
	ctx: ValidationContext,
): RichTextBlock | null {
	assertOnlyKeys(value, new Set(["type", "key", "children"]), path, ctx);
	const children = normalizeSpans(value.children, `${path}.children`, ctx);
	if (type === "quote" && children !== null && !spansToText(children)) {
		addMissingContentIssue(ctx, `${path}.children`, "Quotes need text before publishing");
	}
	return key !== null && children !== null ? { type, key, children } : null;
}

function normalizeHeading(
	value: Record<string, unknown>,
	key: string | null,
	path: string,
	ctx: ValidationContext,
): RichTextBlock | null {
	assertOnlyKeys(value, new Set(["type", "key", "level", "children"]), path, ctx);
	if (value.level !== 2 && value.level !== 3 && value.level !== 4) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.invalidHeadingLevel,
			`${path}.level`,
			"Body headings must use level 2, 3, or 4",
		);
	}
	const children = normalizeSpans(value.children, `${path}.children`, ctx);
	if (children !== null && !spansToText(children)) {
		addMissingContentIssue(ctx, `${path}.children`, "Headings need text before publishing");
	}
	return key !== null
		&& children !== null
		&& (value.level === 2 || value.level === 3 || value.level === 4)
		? { type: "heading" as const, key, level: value.level, children }
		: null;
}

function normalizeList(
	value: Record<string, unknown>,
	key: string | null,
	path: string,
	ctx: ValidationContext,
): RichTextBlock | null {
	assertOnlyKeys(value, new Set(["type", "key", "style", "items"]), path, ctx);
	if (value.style !== "bullet" && value.style !== "number") {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.invalidListStyle,
			`${path}.style`,
			"Lists must be bullet or number lists",
		);
	}
	if (!Array.isArray(value.items)) {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.invalidShape, `${path}.items`, "Expected list items");
		return null;
	}
	if (value.items.length > RICH_TEXT_LIMITS.listItems) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.limitExceeded,
			`${path}.items`,
			`A list cannot contain more than ${RICH_TEXT_LIMITS.listItems} items`,
		);
	}
	const items = value.items
		.map((item, index) => normalizeListItem(item, `${path}.items[${index}]`, ctx))
		.filter((item): item is RichTextListItem => item !== null);
	assertUniqueKeys(items.map((item) => item.key), `${path}.items`, ctx);
	if (items.length === 0) {
		addMissingContentIssue(ctx, `${path}.items`, "Lists need at least one item before publishing");
	}
	for (const [index, item] of items.entries()) {
		if (!spansToText(item.children)) {
			addMissingContentIssue(
				ctx,
				`${path}.items[${index}].children`,
				"List items need text before publishing",
			);
		}
	}
	return key !== null && (value.style === "bullet" || value.style === "number")
		? { type: "list" as const, key, style: value.style, items }
		: null;
}

function normalizeImage(
	value: Record<string, unknown>,
	key: string | null,
	path: string,
	ctx: ValidationContext,
): RichTextBlock | null {
	assertOnlyKeys(
		value,
		new Set(["type", "key", "assetId", "altText", "caption"]),
		path,
		ctx,
	);
	const assetId = readBoundedString(
		value.assetId,
		`${path}.assetId`,
		RICH_TEXT_LIMITS.assetIdCharacters,
		ctx,
	);
	if (assetId !== null && (!assetId.trim() || assetId !== assetId.trim())) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.invalidShape,
			`${path}.assetId`,
			"Media asset IDs must be non-empty and normalized",
		);
	}
	const altText = readOptionalBoundedString(
		value.altText,
		`${path}.altText`,
		RICH_TEXT_LIMITS.altTextCharacters,
		ctx,
	);
	const caption = readOptionalBoundedString(
		value.caption,
		`${path}.caption`,
		RICH_TEXT_LIMITS.captionCharacters,
		ctx,
	);
	if (!altText?.trim()) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.missingImageAlt,
			`${path}.altText`,
			"Images need factual alt text before publishing",
			ctx.mode === "publish" ? "error" : "warning",
		);
	}
	if (key === null || assetId === null || assetId !== assetId.trim()) return null;
	return {
		type: "image" as const,
		key,
		assetId,
		...(altText?.trim() ? { altText: altText.trim() } : {}),
		...(caption?.trim() ? { caption: caption.trim() } : {}),
	};
}

export function normalizeRichTextBlock(
	value: unknown,
	path: string,
	ctx: ValidationContext,
): RichTextBlock | null {
	if (!isRecord(value) || typeof value.type !== "string") {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.invalidShape, path, "Expected a rich-text block");
		return null;
	}
	const key = readKey(value.key, `${path}.key`, ctx);
	if (value.type === "paragraph" || value.type === "quote") {
		return normalizeTextBlock(value, value.type, key, path, ctx);
	}
	if (value.type === "heading") return normalizeHeading(value, key, path, ctx);
	if (value.type === "list") return normalizeList(value, key, path, ctx);
	if (value.type === "image") return normalizeImage(value, key, path, ctx);
	addIssue(
		ctx,
		RICH_TEXT_ISSUE_CODE.invalidShape,
		`${path}.type`,
		`Unsupported rich-text block "${value.type}"`,
	);
	return null;
}
