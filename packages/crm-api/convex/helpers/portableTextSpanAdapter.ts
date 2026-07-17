import {
	RICH_TEXT_ISSUE_CODE,
	RICH_TEXT_LIMITS,
	type RichTextIssue,
	type RichTextMark,
	type RichTextSpan,
} from "./richTextContract";
import {
	isSafeRichTextUrl,
	isValidRichTextKey,
} from "./richTextValidationSupport";

export function isPortableTextRecord(
	value: unknown,
): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function addPortableTextIssue(
	issues: RichTextIssue[],
	code: RichTextIssue["code"],
	path: string,
	message: string,
) {
	issues.push({ code, path, message, severity: "error" });
}

export function assertPortableFields(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	path: string,
	issues: RichTextIssue[],
) {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			addPortableTextIssue(
				issues,
				RICH_TEXT_ISSUE_CODE.unsupportedPortableTextField,
				`${path}.${key}`,
				`Portable Text field "${key}" has no provider-neutral equivalent`,
			);
		}
	}
}

export function readPortableKey(
	value: unknown,
	path: string,
	issues: RichTextIssue[],
) {
	if (typeof value !== "string" || value.length === 0) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.missingKey,
			path,
			"Portable Text key is required",
		);
		return null;
	}
	if (!isValidRichTextKey(value)) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.invalidKey,
			path,
			`Portable Text keys must be ${RICH_TEXT_LIMITS.keyCharacters} characters or fewer and use letters, numbers, dot, underscore, colon, or hyphen`,
		);
		return null;
	}
	return value;
}

export function readPortableText(
	value: unknown,
	path: string,
	issues: RichTextIssue[],
) {
	if (typeof value !== "string") {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.invalidShape,
			path,
			"Expected Portable Text text",
		);
		return null;
	}
	return value;
}

type LinkDefinition = { key: string; href: string };

function readLinkDefinitions(
	value: unknown,
	path: string,
	issues: RichTextIssue[],
) {
	if (value === undefined) return new Map<string, LinkDefinition>();
	if (!Array.isArray(value)) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.invalidShape,
			path,
			"Expected mark definitions",
		);
		return new Map<string, LinkDefinition>();
	}
	if (value.length > RICH_TEXT_LIMITS.markDefinitions) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.limitExceeded,
			path,
			`A Portable Text block cannot contain more than ${RICH_TEXT_LIMITS.markDefinitions} mark definitions`,
		);
	}
	const definitions = new Map<string, LinkDefinition>();
	for (const [index, definition] of value.entries()) {
		const definitionPath = `${path}[${index}]`;
		if (!isPortableTextRecord(definition)) {
			addPortableTextIssue(
				issues,
				RICH_TEXT_ISSUE_CODE.invalidShape,
				definitionPath,
				"Expected a mark definition",
			);
			continue;
		}
		assertPortableFields(
			definition,
			new Set(["_key", "_type", "href"]),
			definitionPath,
			issues,
		);
		if (definition._type !== "link") {
			addPortableTextIssue(
				issues,
				RICH_TEXT_ISSUE_CODE.unsupportedPortableTextMark,
				`${definitionPath}._type`,
				`Portable Text mark definition "${String(definition._type)}" is unsupported`,
			);
			continue;
		}
		const key = readPortableKey(definition._key, `${definitionPath}._key`, issues);
		const href = readPortableText(definition.href, `${definitionPath}.href`, issues);
		if (key === null || href === null) continue;
		if (!isSafeRichTextUrl(href)) {
			addPortableTextIssue(
				issues,
				RICH_TEXT_ISSUE_CODE.invalidUrl,
				`${definitionPath}.href`,
				"Portable Text links must use an allowed URL format and protocol",
			);
		}
		if (definitions.has(key)) {
			addPortableTextIssue(
				issues,
				RICH_TEXT_ISSUE_CODE.duplicateKey,
				`${definitionPath}._key`,
				`Portable Text mark key "${key}" is duplicated`,
			);
			continue;
		}
		definitions.set(key, { key, href });
	}
	return definitions;
}

function convertSpanMarks(
	value: unknown,
	definitions: ReadonlyMap<string, LinkDefinition>,
	path: string,
	issues: RichTextIssue[],
) {
	if (value === undefined) return [];
	if (!Array.isArray(value) || value.some((mark) => typeof mark !== "string")) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.invalidShape,
			path,
			"Expected Portable Text marks",
		);
		return [];
	}
	const marks: RichTextMark[] = [];
	for (const [index, mark] of value.entries()) {
		if (mark === "strong") {
			marks.push({ type: "strong" });
			continue;
		}
		if (mark === "em") {
			marks.push({ type: "emphasis" });
			continue;
		}
		const definition = definitions.get(mark);
		if (definition) {
			marks.push({ type: "link", key: definition.key, href: definition.href });
			continue;
		}
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.unsupportedPortableTextMark,
			`${path}[${index}]`,
			`Portable Text mark "${mark}" is unsupported or unresolved`,
		);
	}
	return marks;
}

function convertSpans(
	value: unknown,
	definitions: ReadonlyMap<string, LinkDefinition>,
	path: string,
	issues: RichTextIssue[],
) {
	if (!Array.isArray(value)) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.invalidShape,
			path,
			"Expected Portable Text children",
		);
		return [];
	}
	const spans: RichTextSpan[] = [];
	for (const [index, child] of value.entries()) {
		const childPath = `${path}[${index}]`;
		if (!isPortableTextRecord(child) || child._type !== "span") {
			addPortableTextIssue(
				issues,
				RICH_TEXT_ISSUE_CODE.unsupportedPortableTextNode,
				childPath,
				`Portable Text child "${isPortableTextRecord(child) ? String(child._type) : typeof child}" is unsupported`,
			);
			continue;
		}
		assertPortableFields(
			child,
			new Set(["_key", "_type", "text", "marks"]),
			childPath,
			issues,
		);
		const key = readPortableKey(child._key, `${childPath}._key`, issues);
		const text = readPortableText(child.text, `${childPath}.text`, issues);
		const marks = convertSpanMarks(
			child.marks,
			definitions,
			`${childPath}.marks`,
			issues,
		);
		if (key !== null && text !== null) spans.push({ type: "text", key, text, marks });
	}
	return spans;
}

export function convertTextBlockContent(
	block: Record<string, unknown>,
	path: string,
	issues: RichTextIssue[],
) {
	const definitions = readLinkDefinitions(block.markDefs, `${path}.markDefs`, issues);
	return convertSpans(block.children, definitions, `${path}.children`, issues);
}
