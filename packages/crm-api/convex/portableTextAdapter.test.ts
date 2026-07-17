import { describe, expect, test } from "vitest";
import {
	RICH_TEXT_ISSUE_CODE,
	RICH_TEXT_LIMITS,
	type RichTextIssueCode,
} from "./helpers/richTextContract";
import { convertPortableText } from "./helpers/portableTextAdapter";
import { serializeRichTextDocument } from "./helpers/richTextValidation";

const SOURCE_ASSET = "image-abc123-1200x800-jpg";
const TARGET_ASSET = "123e4567-e89b-42d3-a456-426614174000";

function liveShapeFixture() {
	return [
		{
			_type: "block",
			_key: "paragraph-1",
			style: "normal",
			markDefs: [
				{ _type: "link", _key: "unused-link", href: "https://unused.example" },
				{ _type: "link", _key: "link-1", href: "https://example.com/story" },
			],
			children: [
				{ _type: "span", _key: "empty", text: "", marks: [] },
				{
					_type: "span",
					_key: "combined",
					text: "Read the story",
					marks: ["link-1", "strong", "em"],
				},
			],
		},
		{
			_type: "block",
			_key: "heading-1",
			style: "h2",
			markDefs: [],
			children: [{ _type: "span", _key: "heading-text", text: "Process", marks: [] }],
		},
		{
			_type: "block",
			_key: "bullet-1",
			style: "normal",
			listItem: "bullet",
			level: 1,
			markDefs: [],
			children: [{ _type: "span", _key: "item-text", text: "First", marks: [] }],
		},
		{
			_type: "block",
			_key: "bullet-2",
			style: "normal",
			listItem: "bullet",
			level: 1,
			markDefs: [],
			children: [{ _type: "span", _key: "item-text", text: "Second", marks: [] }],
		},
		{
			_type: "image",
			_key: "image-1",
			asset: { _type: "reference", _ref: SOURCE_ASSET },
			alt: null,
			caption: null,
		},
		{
			_type: "block",
			_key: "paragraph-2",
			style: "normal",
			markDefs: [],
			children: [{ _type: "span", _key: "body", text: "An interruption.", marks: [] }],
		},
		{
			_type: "block",
			_key: "bullet-3",
			style: "normal",
			listItem: "bullet",
			level: 1,
			markDefs: [],
			children: [{ _type: "span", _key: "item-text", text: "Third", marks: [] }],
		},
		{
			_type: "block",
			_key: "quote-1",
			style: "blockquote",
			markDefs: [],
			children: [{ _type: "span", _key: "quote-text", text: "A final thought.", marks: [] }],
		},
	];
}

function convert(
	value: unknown,
	options: { mode?: "draft" | "publish"; mapped?: boolean } = {},
) {
	return convertPortableText(value, {
		imageAssetIds: options.mapped === false ? {} : { [SOURCE_ASSET]: TARGET_ASSET },
		mode: options.mode,
	});
}

function codes(value: unknown, options?: Parameters<typeof convert>[1]) {
	return convert(value, options).issues.map((issue) => issue.code);
}

describe("Portable Text migration boundary", () => {
	test("converts the complete live-used shape into one provider-neutral golden document", () => {
		const result = convert(liveShapeFixture());
		expect(result.issues).toEqual([
			expect.objectContaining({
				code: RICH_TEXT_ISSUE_CODE.missingImageAlt,
				severity: "warning",
			}),
		]);
		expect(result.document).toEqual({
			version: 1,
			blocks: [
				{
					type: "paragraph",
					key: "paragraph-1",
					children: [
						{ type: "text", key: "empty", text: "", marks: [] },
						{
							type: "text",
							key: "combined",
							text: "Read the story",
							marks: [
								{ type: "strong" },
								{ type: "emphasis" },
								{ type: "link", key: "link-1", href: "https://example.com/story" },
							],
						},
					],
				},
				{
					type: "heading",
					key: "heading-1",
					level: 2,
					children: [{ type: "text", key: "heading-text", text: "Process", marks: [] }],
				},
				{
					type: "list",
					key: "bullet-1",
					style: "bullet",
					items: [
						{
							key: "bullet-1",
							children: [{ type: "text", key: "item-text", text: "First", marks: [] }],
						},
						{
							key: "bullet-2",
							children: [{ type: "text", key: "item-text", text: "Second", marks: [] }],
						},
					],
				},
				{ type: "image", key: "image-1", assetId: TARGET_ASSET },
				{
					type: "paragraph",
					key: "paragraph-2",
					children: [{ type: "text", key: "body", text: "An interruption.", marks: [] }],
				},
				{
					type: "list",
					key: "bullet-3",
					style: "bullet",
					items: [
						{
							key: "bullet-3",
							children: [{ type: "text", key: "item-text", text: "Third", marks: [] }],
						},
					],
				},
				{
					type: "quote",
					key: "quote-1",
					children: [{ type: "text", key: "quote-text", text: "A final thought.", marks: [] }],
				},
			],
		});
	});

	test("groups only contiguous list items and preserves deliberate order", () => {
		const result = convert(liveShapeFixture());
		expect(result.document?.blocks.map((block) => `${block.type}:${block.key}`)).toEqual([
			"paragraph:paragraph-1",
			"heading:heading-1",
			"list:bullet-1",
			"image:image-1",
			"paragraph:paragraph-2",
			"list:bullet-3",
			"quote:quote-1",
		]);
	});

	test("rejects duplicate top-level keys even when list regrouping would hide them", () => {
		const fixture = liveShapeFixture();
		(fixture[3] as { _key: string })._key = "paragraph-2";

		const result = convert(fixture);
		expect(result.document).toBeNull();
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				code: RICH_TEXT_ISSUE_CODE.duplicateKey,
				path: "$[5]._key",
			}),
		);
	});

	test("preserves a standalone empty paragraph in its authored position", () => {
		const fixture = [
			{
				_type: "block",
				_key: "before",
				style: "normal",
				markDefs: [],
				children: [{ _type: "span", _key: "before-text", text: "Before", marks: [] }],
			},
			{
				_type: "block",
				_key: "empty",
				style: "normal",
				markDefs: [],
				children: [{ _type: "span", _key: "empty-text", text: "", marks: [] }],
			},
			{
				_type: "block",
				_key: "after",
				style: "normal",
				markDefs: [],
				children: [{ _type: "span", _key: "after-text", text: "After", marks: [] }],
			},
		];

		const result = convert(fixture);
		expect(result.issues).toEqual([]);
		expect(result.document?.blocks).toEqual([
			{
				type: "paragraph",
				key: "before",
				children: [{ type: "text", key: "before-text", text: "Before", marks: [] }],
			},
			{
				type: "paragraph",
				key: "empty",
				children: [{ type: "text", key: "empty-text", text: "", marks: [] }],
			},
			{
				type: "paragraph",
				key: "after",
				children: [{ type: "text", key: "after-text", text: "After", marks: [] }],
			},
		]);
	});

	test.each([
		["h3", 3],
		["h4", 4],
	] as const)("converts Portable Text %s without flattening it", (style, level) => {
		const fixture = liveShapeFixture();
		(fixture[1] as { style: string }).style = style;

		const result = convert(fixture);
		expect(result.document?.blocks[1]).toEqual({
			type: "heading",
			key: "heading-1",
			level,
			children: [{ type: "text", key: "heading-text", text: "Process", marks: [] }],
		});
	});

	test("canonicalizes equivalent source mark and mark-definition ordering", () => {
		const left = liveShapeFixture();
		const right = structuredClone(left);
		const rightParagraph = right[0] as {
			markDefs: unknown[];
			children: Array<{ marks: string[] }>;
		};
		rightParagraph.markDefs.reverse();
		rightParagraph.children[1].marks.reverse();
		const leftDocument = convert(left).document;
		const rightDocument = convert(right).document;
		expect(leftDocument).not.toBeNull();
		expect(rightDocument).not.toBeNull();
		expect(serializeRichTextDocument(leftDocument)).toBe(
			serializeRichTextDocument(rightDocument),
		);
	});

	test("keeps missing alt text draft-compatible but blocks publication", () => {
		const draft = convert(liveShapeFixture());
		expect(draft.document).not.toBeNull();
		expect(draft.issues).toContainEqual(
			expect.objectContaining({
				code: RICH_TEXT_ISSUE_CODE.missingImageAlt,
				severity: "warning",
			}),
		);
		const blocked = convert(liveShapeFixture(), { mode: "publish" });
		expect(blocked.document).toBeNull();
		expect(blocked.issues).toContainEqual(
			expect.objectContaining({
				code: RICH_TEXT_ISSUE_CODE.missingImageAlt,
				severity: "error",
			}),
		);

		const complete = liveShapeFixture();
		const image = complete[4] as { alt: string | null };
		image.alt = "Camera equipment arranged beside a portrait set.";
		expect(convert(complete, { mode: "publish" }).issues).toEqual([]);
	});

	test.each<[string, (fixture: ReturnType<typeof liveShapeFixture>) => unknown, RichTextIssueCode]>([
		[
			"body H1",
			(fixture) => ({ ...(fixture[1] as object), style: "h1" }),
			RICH_TEXT_ISSUE_CODE.unsupportedPortableTextStyle,
		],
		[
			"unknown node",
			() => ({ _type: "code", _key: "code-1", code: "alert(1)" }),
			RICH_TEXT_ISSUE_CODE.unsupportedPortableTextNode,
		],
		[
			"nested list",
			(fixture) => ({ ...(fixture[2] as object), level: 2 }),
			RICH_TEXT_ISSUE_CODE.unsupportedPortableTextList,
		],
		[
			"unknown mark",
			(fixture) => ({
				...(fixture[0] as object),
				children: [{ _type: "span", _key: "span", text: "Code", marks: ["code"] }],
				markDefs: [],
			}),
			RICH_TEXT_ISSUE_CODE.unsupportedPortableTextMark,
		],
		[
			"image hotspot",
			(fixture) => ({ ...(fixture[4] as object), hotspot: { x: 0.5, y: 0.5 } }),
			RICH_TEXT_ISSUE_CODE.unsupportedPortableTextField,
		],
	])("rejects unsupported %s without silently rewriting it", (_label, mutate, expectedCode) => {
		const fixture = liveShapeFixture();
		fixture[0] = mutate(fixture) as (typeof fixture)[number];
		const result = convert(fixture);
		expect(result.document).toBeNull();
		expect(result.issues.map((issue) => issue.code)).toContain(expectedCode);
	});

	test.each(["crop", "focalPoint", "decorative"] as const)(
		"rejects source image %s metadata instead of silently discarding it",
		(field) => {
			const fixture = liveShapeFixture();
			(fixture[4] as Record<string, unknown>)[field] = field === "decorative"
				? true
				: { x: 0.5, y: 0.5 };

			const result = convert(fixture);
			expect(result.document).toBeNull();
			expect(result.issues).toContainEqual(
				expect.objectContaining({
					code: RICH_TEXT_ISSUE_CODE.unsupportedPortableTextField,
					path: `$[4].${field}`,
				}),
			);
		},
	);

	test("rejects image assets whose source object is not a Sanity reference", () => {
		const fixture = liveShapeFixture();
		(fixture[4] as { asset: { _type: string } }).asset._type = "image";

		const result = convert(fixture);
		expect(result.document).toBeNull();
		expect(result.issues).toContainEqual(
			expect.objectContaining({
				code: RICH_TEXT_ISSUE_CODE.invalidShape,
				path: "$[4].asset._type",
			}),
		);
	});

	test("rejects unsafe or dangling links with path-aware diagnostics", () => {
		const unsafe = liveShapeFixture();
		const unsafeParagraph = unsafe[0] as { markDefs: Array<{ href: string }> };
		unsafeParagraph.markDefs[1].href = "javascript:alert(1)";
		const unsafeResult = convert(unsafe);
		expect(unsafeResult.document).toBeNull();
		expect(unsafeResult.issues).toContainEqual(
			expect.objectContaining({
				code: RICH_TEXT_ISSUE_CODE.invalidUrl,
				path: "$.blocks[0].children[1].marks[0].href",
			}),
		);

		const dangling = liveShapeFixture();
		const danglingParagraph = dangling[0] as {
			children: Array<{ marks: string[] }>;
		};
		danglingParagraph.children[1].marks[0] = "missing-link";
		expect(codes(dangling)).toContain(RICH_TEXT_ISSUE_CODE.unsupportedPortableTextMark);
	});

	test("requires deterministic target media mappings and never leaks Sanity shapes", () => {
		const unresolved = convert(liveShapeFixture(), { mapped: false });
		expect(unresolved.document).toBeNull();
		expect(unresolved.issues).toContainEqual(
			expect.objectContaining({ code: RICH_TEXT_ISSUE_CODE.unresolvedImageAsset }),
		);

		const converted = convert(liveShapeFixture());
		const serialized = JSON.stringify(converted.document);
		expect(serialized).not.toMatch(/_type|_ref|cdn\.sanity|crop|hotspot/);
		expect(serialized).not.toContain(SOURCE_ASSET);
		expect(serialized).toContain(TARGET_ASSET);
	});

	test("returns stable diagnostics for malformed roots, duplicate definitions, and missing keys", () => {
		expect(codes({ blocks: [] })).toEqual([RICH_TEXT_ISSUE_CODE.invalidShape]);

		const duplicateDefinition = liveShapeFixture();
		const paragraph = duplicateDefinition[0] as { markDefs: unknown[] };
		paragraph.markDefs.push({ _type: "link", _key: "link-1", href: "https://other.example" });
		expect(codes(duplicateDefinition)).toContain(RICH_TEXT_ISSUE_CODE.duplicateKey);

		const excessiveDefinitions = liveShapeFixture();
		const excessiveParagraph = excessiveDefinitions[0] as { markDefs: unknown[] };
		excessiveParagraph.markDefs = Array.from(
			{ length: RICH_TEXT_LIMITS.markDefinitions + 1 },
			(_, index) => ({
			_type: "link",
			_key: index === 0 ? "link-1" : `link-${index + 1}`,
			href: `https://example.com/${index}`,
			}),
		);
		expect(codes(excessiveDefinitions)).toContain(RICH_TEXT_ISSUE_CODE.limitExceeded);

		const missingKey = liveShapeFixture();
		delete (missingKey[1] as { _key?: string })._key;
		expect(codes(missingKey)).toContain(RICH_TEXT_ISSUE_CODE.missingKey);
	});

	test.each([
		[
			"invalid key",
			{ _type: "link", _key: "invalid key", href: "https://unused.example" },
			RICH_TEXT_ISSUE_CODE.invalidKey,
			"$[0].markDefs[0]._key",
		],
		[
			"overlong key",
			{
				_type: "link",
				_key: "k".repeat(RICH_TEXT_LIMITS.keyCharacters + 1),
				href: "https://unused.example",
			},
			RICH_TEXT_ISSUE_CODE.invalidKey,
			"$[0].markDefs[0]._key",
		],
		[
			"invalid href",
			{ _type: "link", _key: "unused-link", href: "relative/path" },
			RICH_TEXT_ISSUE_CODE.invalidUrl,
			"$[0].markDefs[0].href",
		],
		[
			"overlong href",
			{
				_type: "link",
				_key: "unused-link",
				href: `https://example.com/${"a".repeat(RICH_TEXT_LIMITS.urlCharacters)}`,
			},
			RICH_TEXT_ISSUE_CODE.invalidUrl,
			"$[0].markDefs[0].href",
		],
	] as const)(
		"validates an unused link definition with an %s",
		(_label, definition, expectedCode, expectedPath) => {
			const fixture = liveShapeFixture();
			const paragraph = fixture[0] as { markDefs: unknown[] };
			paragraph.markDefs[0] = definition;

			const result = convert(fixture);
			expect(result.document).toBeNull();
			expect(result.issues).toContainEqual(
				expect.objectContaining({ code: expectedCode, path: expectedPath }),
			);
		},
	);
});
