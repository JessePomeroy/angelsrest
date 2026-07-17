import { describe, expect, test } from "vitest";
import {
	RICH_TEXT_ISSUE_CODE,
	RICH_TEXT_LIMITS,
	type RichTextDocument,
	type RichTextMark,
} from "./helpers/richTextContract";
import {
	assertRichTextDocument,
	inspectRichTextDocument,
	isSafeRichTextUrl,
	richTextToPlainText,
	RichTextValidationError,
	serializeRichTextDocument,
} from "./helpers/richTextValidation";

function span(
	key: string,
	text: string,
	marks: RichTextMark[] = [],
) {
	return { type: "text" as const, key, text, marks };
}

function validDocument(): RichTextDocument {
	return {
		version: 1,
		blocks: [
			{
				type: "paragraph",
				key: "paragraph-1",
				children: [span("span-1", "An opening paragraph.")],
			},
			{
				type: "heading",
				key: "heading-1",
				level: 2,
				children: [span("span-2", "A section")],
			},
			{
				type: "quote",
				key: "quote-1",
				children: [span("span-3", "Meaningful words.")],
			},
			{
				type: "list",
				key: "list-1",
				style: "bullet",
				items: [
					{ key: "item-1", children: [span("span-4", "First item")] },
					{ key: "item-2", children: [span("span-5", "Second item")] },
				],
			},
			{
				type: "list",
				key: "list-2",
				style: "number",
				items: [{ key: "item-3", children: [span("span-6", "Numbered item")] }],
			},
			{
				type: "image",
				key: "image-1",
				assetId: "123e4567-e89b-42d3-a456-426614174000",
				altText: "A photographer framing a portrait outdoors.",
				caption: "Behind the scenes.",
			},
		],
	};
}

function issueCodes(value: unknown, mode: "draft" | "publish" = "draft") {
	return inspectRichTextDocument(value, mode).issues.map((issue) => issue.code);
}

describe("provider-neutral rich-text contract", () => {
	test("accepts the deliberately bounded semantic vocabulary", () => {
		const inspected = inspectRichTextDocument(validDocument(), "publish");
		expect(inspected.issues).toEqual([]);
		expect(inspected.document).toEqual(validDocument());
		expect(JSON.stringify(inspected.document)).not.toMatch(
			/_type|_ref|<script|fontFamily|textAlign|style=/,
		);
	});

	test.each([2, 3, 4] as const)("accepts body heading level H%s", (level) => {
		const document = {
			version: 1,
			blocks: [{ type: "heading", key: `h${level}`, level, children: [span("text", "Heading")] }],
		};
		expect(inspectRichTextDocument(document, "publish").issues).toEqual([]);
	});

	test("preserves blank paragraphs but gates non-substantive structures at publication", () => {
		const blankParagraph = {
			version: 1,
			blocks: [{ type: "paragraph", key: "blank", children: [span("empty", "")] }],
		};
		const draft = inspectRichTextDocument(blankParagraph, "draft");
		expect(draft.document).not.toBeNull();
		expect(draft.issues).toMatchObject([
			{ code: RICH_TEXT_ISSUE_CODE.missingContent, severity: "warning", path: "$.blocks" },
		]);
		expect(issueCodes(blankParagraph, "publish")).toContain(
			RICH_TEXT_ISSUE_CODE.missingContent,
		);

		const withText = {
			...blankParagraph,
			blocks: [
				...blankParagraph.blocks,
				{ type: "paragraph", key: "text", children: [span("same-key", "Visible text")] },
			],
		};
		expect(inspectRichTextDocument(withText, "publish").document).not.toBeNull();

		for (const block of [
			{ type: "heading", key: "heading", level: 2, children: [span("empty", "  ")] },
			{ type: "quote", key: "quote", children: [span("empty", "")] },
			{ type: "list", key: "list", style: "bullet", items: [] },
		]) {
			const value = { version: 1, blocks: [block, withText.blocks[1]] };
			expect(issueCodes(value, "publish")).toContain(RICH_TEXT_ISSUE_CODE.missingContent);
		}
	});

	test("allows image alt review in drafts and requires meaningful alt text to publish", () => {
		const document = validDocument();
		const image = document.blocks.at(-1);
		if (!image || image.type !== "image") throw new Error("Expected fixture image");
		delete image.altText;

		const draft = inspectRichTextDocument(document, "draft");
		expect(draft.document).not.toBeNull();
		expect(draft.issues).toContainEqual(
			expect.objectContaining({
				code: RICH_TEXT_ISSUE_CODE.missingImageAlt,
				severity: "warning",
			}),
		);
		const published = inspectRichTextDocument(document, "publish");
		expect(published.document).toBeNull();
		expect(published.issues).toContainEqual(
			expect.objectContaining({
				code: RICH_TEXT_ISSUE_CODE.missingImageAlt,
				severity: "error",
			}),
		);
	});

	test("accepts only safe link destinations", () => {
		for (const href of [
			"https://example.com/path",
			"http://example.com",
			"mailto:hello@example.com",
			"tel:+13125550100",
			"/blog/a-post",
			"#details",
		]) expect(isSafeRichTextUrl(href)).toBe(true);
		for (const href of [
			"",
			"javascript:alert(1)",
			"data:text/html,hello",
			"//evil.example",
			"relative/path",
		]) expect(isSafeRichTextUrl(href)).toBe(false);

		const document = validDocument();
		const paragraph = document.blocks[0];
		if (paragraph.type !== "paragraph") throw new Error("Expected paragraph");
		paragraph.children[0].marks = [
			{ type: "link", key: "unsafe", href: "javascript:alert(1)" },
		];
		expect(issueCodes(document)).toContain(RICH_TEXT_ISSUE_CODE.invalidUrl);
	});

	test("scopes key uniqueness while retaining repeated source span keys across blocks", () => {
		const repeatedAcrossBlocks = {
			version: 1,
			blocks: [
				{ type: "paragraph", key: "one", children: [span("repeated", "One")] },
				{ type: "paragraph", key: "two", children: [span("repeated", "Two")] },
			],
		};
		expect(inspectRichTextDocument(repeatedAcrossBlocks, "publish").document).not.toBeNull();

		const duplicateBlock = structuredClone(repeatedAcrossBlocks);
		duplicateBlock.blocks[1].key = "one";
		expect(issueCodes(duplicateBlock)).toContain(RICH_TEXT_ISSUE_CODE.duplicateKey);

		const duplicateSpan = structuredClone(repeatedAcrossBlocks);
		duplicateSpan.blocks[0].children.push(span("repeated", "Again"));
		expect(issueCodes(duplicateSpan)).toContain(RICH_TEXT_ISSUE_CODE.duplicateKey);

		const missingKey = structuredClone(repeatedAcrossBlocks) as unknown as {
			version: number;
			blocks: Array<Record<string, unknown>>;
		};
		delete missingKey.blocks[0].key;
		expect(issueCodes(missingKey)).toContain(RICH_TEXT_ISSUE_CODE.missingKey);
	});

	test("rejects unsupported shape and bounded-count overflow", () => {
		const unknownField = { ...validDocument(), html: "<p>not allowed</p>" };
		expect(issueCodes(unknownField)).toContain(RICH_TEXT_ISSUE_CODE.unsupportedField);

		const h1 = {
			version: 1,
			blocks: [{ type: "heading", key: "h1", level: 1, children: [span("s", "Title")] }],
		};
		expect(issueCodes(h1)).toContain(RICH_TEXT_ISSUE_CODE.invalidHeadingLevel);

		const tooManyBlocks = {
			version: 1,
			blocks: Array.from({ length: RICH_TEXT_LIMITS.blocks + 1 }, (_, index) => ({
				type: "paragraph",
				key: `block-${index}`,
				children: [span("span", "")],
			})),
		};
		expect(issueCodes(tooManyBlocks)).toContain(RICH_TEXT_ISSUE_CODE.limitExceeded);
	});

	test("enforces span, collection, mark, URL, and image text bounds at their edges", () => {
		const exactUrlPrefix = "https://example.com/";
		const exactUrl = exactUrlPrefix + "a".repeat(
			RICH_TEXT_LIMITS.urlCharacters - exactUrlPrefix.length,
		);
		const exact = {
			version: 1,
			blocks: [
				{
					type: "paragraph",
					key: "paragraph",
					children: Array.from({ length: RICH_TEXT_LIMITS.spans }, (_, index) =>
						span(`span-${index}`, index === 0 ? "x".repeat(RICH_TEXT_LIMITS.spanCharacters) : ""),
					),
				},
				{
					type: "list",
					key: "list",
					style: "bullet",
					items: Array.from({ length: RICH_TEXT_LIMITS.listItems }, (_, index) => ({
						key: `item-${index}`,
						children: [span("text", `Item ${index}`)],
					})),
				},
				{
					type: "paragraph",
					key: "marks",
					children: [
						span("marked", "Linked", [
							{ type: "strong" },
							{ type: "emphasis" },
							{ type: "link", key: "link", href: exactUrl },
						]),
					],
				},
				{
					type: "image",
					key: "image",
					assetId: "asset",
					altText: "a".repeat(RICH_TEXT_LIMITS.altTextCharacters),
					caption: "c".repeat(RICH_TEXT_LIMITS.captionCharacters),
				},
			],
		};
		expect(inspectRichTextDocument(exact, "publish").document).not.toBeNull();

		const tooManySpans = structuredClone(exact);
		const firstBlock = tooManySpans.blocks[0];
		if (!Array.isArray(firstBlock.children)) throw new Error("Expected text block");
		firstBlock.children.push(span("overflow", "x"));

		const tooManyListItems = structuredClone(exact);
		const listBlock = tooManyListItems.blocks[1];
		if (!Array.isArray(listBlock.items)) throw new Error("Expected list block");
		listBlock.items.push({ key: "overflow", children: [span("text", "Overflow")] });

		const tooManyMarks = structuredClone(exact);
		const marksBlock = tooManyMarks.blocks[2];
		if (!Array.isArray(marksBlock.children)) throw new Error("Expected marks block");
		marksBlock.children[0].marks.push({ type: "strong" });

		const longSpan = structuredClone(exact);
		const longSpanBlock = longSpan.blocks[0];
		if (!Array.isArray(longSpanBlock.children)) throw new Error("Expected text block");
		longSpanBlock.children[0].text += "x";

		const longImage = structuredClone(exact);
		const imageBlock = longImage.blocks[3];
		if (typeof imageBlock.altText !== "string" || typeof imageBlock.caption !== "string") {
			throw new Error("Expected image block");
		}
		imageBlock.altText += "a";
		imageBlock.caption += "c";

		const longUrl = structuredClone(exact);
		const longUrlBlock = longUrl.blocks[2];
		if (!Array.isArray(longUrlBlock.children)) throw new Error("Expected marks block");
		const link = longUrlBlock.children[0].marks.find((mark) => mark.type === "link");
		if (!link || link.type !== "link") throw new Error("Expected link mark");
		link.href += "a";

		for (const value of [
			tooManySpans,
			tooManyListItems,
			tooManyMarks,
			longSpan,
			longImage,
			longUrl,
		]) expect(issueCodes(value)).toContain(RICH_TEXT_ISSUE_CODE.limitExceeded);
	});

	test("enforces stable key and media asset ID bounds at their exact edges", () => {
		const exactKey = `k${"a".repeat(RICH_TEXT_LIMITS.keyCharacters - 1)}`;
		const exactAssetId = "a".repeat(RICH_TEXT_LIMITS.assetIdCharacters);
		const exact = {
			version: 1,
			blocks: [
				{
					type: "paragraph",
					key: exactKey,
					children: [span(exactKey, "Visible text")],
				},
				{
					type: "image",
					key: "image",
					assetId: exactAssetId,
					altText: "A descriptive image.",
				},
			],
		};
		expect(inspectRichTextDocument(exact, "publish").document).not.toBeNull();

		const longBlockKey = structuredClone(exact);
		longBlockKey.blocks[0].key += "a";
		expect(issueCodes(longBlockKey)).toContain(RICH_TEXT_ISSUE_CODE.invalidKey);

		const longSpanKey = structuredClone(exact);
		if (!Array.isArray(longSpanKey.blocks[0].children)) {
			throw new Error("Expected paragraph children");
		}
		longSpanKey.blocks[0].children[0].key += "a";
		expect(issueCodes(longSpanKey)).toContain(RICH_TEXT_ISSUE_CODE.invalidKey);

		const longAssetId = structuredClone(exact);
		if (typeof longAssetId.blocks[1].assetId !== "string") {
			throw new Error("Expected image asset ID");
		}
		longAssetId.blocks[1].assetId += "a";
		expect(issueCodes(longAssetId)).toContain(RICH_TEXT_ISSUE_CODE.limitExceeded);
	});

	test("enforces aggregate character and block bounds at exact and over-limit sizes", () => {
		const exactCharacters = {
			version: 1,
			blocks: [
				{
					type: "paragraph",
					key: "paragraph",
					children: Array.from(
						{ length: RICH_TEXT_LIMITS.totalCharacters / RICH_TEXT_LIMITS.spanCharacters },
						(_, index) => span(`span-${index}`, "x".repeat(RICH_TEXT_LIMITS.spanCharacters)),
					),
				},
			],
		};
		expect(inspectRichTextDocument(exactCharacters, "publish").document).not.toBeNull();

		const overCharacters = structuredClone(exactCharacters);
		overCharacters.blocks[0].children.push(span("overflow", "x"));
		expect(issueCodes(overCharacters)).toContain(RICH_TEXT_ISSUE_CODE.limitExceeded);

		const exactBlocks = {
			version: 1,
			blocks: Array.from({ length: RICH_TEXT_LIMITS.blocks }, (_, index) => ({
				type: "paragraph",
				key: `block-${index}`,
				children: [span("text", index === 0 ? "Visible text" : "")],
			})),
		};
		expect(inspectRichTextDocument(exactBlocks, "publish").document).not.toBeNull();

		const overBlocks = structuredClone(exactBlocks);
		overBlocks.blocks.push({
			type: "paragraph",
			key: "overflow",
			children: [span("text", "")],
		});
		expect(issueCodes(overBlocks)).toContain(RICH_TEXT_ISSUE_CODE.limitExceeded);
	});

	test("caps aggregate serialized size below the Convex value ceiling", () => {
		const structurallyLarge = {
			version: 1,
			blocks: Array.from({ length: 250 }, (_, blockIndex) => ({
				type: "paragraph",
				key: `block-${blockIndex}`,
				children: Array.from({ length: RICH_TEXT_LIMITS.spans }, (_, spanIndex) =>
					span(`span-${spanIndex}`, ""),
				),
			})),
		};
		const inspected = inspectRichTextDocument(structurallyLarge, "draft");
		expect(inspected.document).toBeNull();
		expect(inspected.issues).toContainEqual(
			expect.objectContaining({ code: RICH_TEXT_ISSUE_CODE.limitExceeded, path: "$" }),
		);
	});

	test("serializes equivalent marks canonically but preserves authored sequence", () => {
		const left = validDocument();
		const right = validDocument();
		const leftParagraph = left.blocks[0];
		const rightParagraph = right.blocks[0];
		if (leftParagraph.type !== "paragraph" || rightParagraph.type !== "paragraph") {
			throw new Error("Expected paragraph fixtures");
		}
		const marks: RichTextMark[] = [
			{ type: "link", key: "link-1", href: "https://example.com" },
			{ type: "emphasis" },
			{ type: "strong" },
		];
		leftParagraph.children[0].marks = marks;
		rightParagraph.children[0].marks = [...marks].reverse();
		expect(serializeRichTextDocument(left, "publish")).toBe(
			serializeRichTextDocument(right, "publish"),
		);

		const reordered = validDocument();
		reordered.blocks = [...reordered.blocks].reverse();
		expect(serializeRichTextDocument(reordered, "publish")).not.toBe(
			serializeRichTextDocument(validDocument(), "publish"),
		);
	});

	test("projects authored text in order without provider or image metadata", () => {
		expect(richTextToPlainText(validDocument())).toBe(
			[
				"An opening paragraph.",
				"A section",
				"Meaningful words.",
				"First item",
				"Second item",
				"Numbered item",
			].join("\n\n"),
		);
	});

	test("throws stable code and path diagnostics for callers that assert validity", () => {
		expect(() => assertRichTextDocument({ version: 2, blocks: [] })).toThrow(
			RichTextValidationError,
		);
		try {
			assertRichTextDocument({ version: 2, blocks: [] });
		} catch (error) {
			expect(error).toBeInstanceOf(RichTextValidationError);
			if (!(error instanceof RichTextValidationError)) return;
			expect(error.issues[0]).toMatchObject({
				code: RICH_TEXT_ISSUE_CODE.unsupportedVersion,
				path: "$.version",
			});
		}
	});
});
