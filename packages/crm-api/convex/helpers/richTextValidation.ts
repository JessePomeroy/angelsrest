import {
	hasRichTextErrors,
	RICH_TEXT_ISSUE_CODE,
	RICH_TEXT_LIMITS,
	RICH_TEXT_SCHEMA_VERSION,
	type RichTextBlock,
	type RichTextDocument,
	type RichTextIssue,
	type RichTextValidationMode,
} from "./richTextContract";
import { normalizeRichTextBlock } from "./richTextNodeValidation";
import {
	addIssue,
	addMissingContentIssue,
	assertOnlyKeys,
	assertUniqueKeys,
	createValidationContext,
	isRecord,
	spansToText,
} from "./richTextValidationSupport";

export { isSafeRichTextUrl } from "./richTextValidationSupport";

export type RichTextInspection = {
	document: RichTextDocument | null;
	issues: RichTextIssue[];
};

export class RichTextValidationError extends Error {
	readonly issues: RichTextIssue[];

	constructor(issues: RichTextIssue[]) {
		super(issues.map((issue) => `${issue.path}: ${issue.message}`).join("; "));
		this.name = "RichTextValidationError";
		this.issues = issues;
	}
}

function hasSubstantiveContent(blocks: RichTextBlock[]) {
	return blocks.some((block) => {
		if (block.type === "image") return true;
		if (block.type === "list") {
			return block.items.some((item) => Boolean(spansToText(item.children)));
		}
		return Boolean(spansToText(block.children));
	});
}

/**
 * Issue paths use a stable JSONPath subset (`$`, `.field`, and `[index]`) and
 * validation traverses source arrays in order. Codes and paths are contract;
 * human-readable messages may improve without changing the contract.
 */
export function inspectRichTextDocument(
	value: unknown,
	mode: RichTextValidationMode = "draft",
): RichTextInspection {
	const ctx = createValidationContext(mode);
	if (!isRecord(value)) {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.invalidShape, "$", "Expected a rich-text document");
		return { document: null, issues: ctx.issues };
	}
	assertOnlyKeys(value, new Set(["version", "blocks"]), "$", ctx);
	if (value.version !== RICH_TEXT_SCHEMA_VERSION) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.unsupportedVersion,
			"$.version",
			`Rich text must use schema version ${RICH_TEXT_SCHEMA_VERSION}`,
		);
	}
	if (!Array.isArray(value.blocks)) {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.invalidShape, "$.blocks", "Expected rich-text blocks");
		return { document: null, issues: ctx.issues };
	}
	if (value.blocks.length > RICH_TEXT_LIMITS.blocks) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.limitExceeded,
			"$.blocks",
			`Rich text cannot contain more than ${RICH_TEXT_LIMITS.blocks} blocks`,
		);
	}
	const blocks = value.blocks
		.map((block, index) => normalizeRichTextBlock(block, `$.blocks[${index}]`, ctx))
		.filter((block): block is RichTextBlock => block !== null);
	assertUniqueKeys(blocks.map((block) => block.key), "$.blocks", ctx);
	if (!hasSubstantiveContent(blocks)) {
		addMissingContentIssue(ctx, "$.blocks", "Rich text needs substantive content before publishing");
	}

	const candidate: RichTextDocument = { version: RICH_TEXT_SCHEMA_VERSION, blocks };
	if (!hasRichTextErrors(ctx.issues)) {
		const serializedBytes = new TextEncoder().encode(JSON.stringify(candidate)).byteLength;
		if (serializedBytes > RICH_TEXT_LIMITS.serializedBytes) {
			addIssue(
				ctx,
				RICH_TEXT_ISSUE_CODE.limitExceeded,
				"$",
				`Serialized rich text cannot exceed ${RICH_TEXT_LIMITS.serializedBytes} bytes`,
			);
		}
	}
	return {
		document: hasRichTextErrors(ctx.issues) ? null : candidate,
		issues: ctx.issues,
	};
}

export function assertRichTextDocument(
	value: unknown,
	mode: RichTextValidationMode = "draft",
) {
	const inspected = inspectRichTextDocument(value, mode);
	if (inspected.document === null) {
		throw new RichTextValidationError(inspected.issues);
	}
	return inspected.document;
}

export function serializeRichTextDocument(
	value: unknown,
	mode: RichTextValidationMode = "draft",
) {
	return JSON.stringify(assertRichTextDocument(value, mode));
}

export function richTextToPlainText(value: unknown) {
	const document = assertRichTextDocument(value, "draft");
	return document.blocks
		.flatMap((block) => {
			if (block.type === "paragraph" || block.type === "heading" || block.type === "quote") {
				return [spansToText(block.children)];
			}
			if (block.type === "list") {
				return block.items.map((item) => spansToText(item.children));
			}
			return [];
		})
		.filter(Boolean)
		.join("\n\n");
}
