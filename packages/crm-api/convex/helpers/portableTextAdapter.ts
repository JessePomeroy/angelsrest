import {
	hasRichTextErrors,
	RICH_TEXT_ISSUE_CODE,
	RICH_TEXT_SCHEMA_VERSION,
	type RichTextBlock,
	type RichTextDocument,
	type RichTextIssue,
	type RichTextListItem,
	type RichTextValidationMode,
} from "./richTextContract";
import {
	addPortableTextIssue,
	assertPortableFields,
	convertTextBlockContent,
	isPortableTextRecord,
	readPortableKey,
	readPortableText,
} from "./portableTextSpanAdapter";
import { inspectRichTextDocument } from "./richTextValidation";

type PortableTextAdapterOptions = {
	imageAssetIds: Readonly<Record<string, string>>;
	mode?: RichTextValidationMode;
};

export type PortableTextConversionResult = {
	document: RichTextDocument | null;
	issues: RichTextIssue[];
};

function assertUniquePortableTextKeys(
	values: unknown[],
	issues: RichTextIssue[],
) {
	const seen = new Set<string>();
	for (const [index, value] of values.entries()) {
		if (!isPortableTextRecord(value) || typeof value._key !== "string") continue;
		if (seen.has(value._key)) {
			addPortableTextIssue(
				issues,
				RICH_TEXT_ISSUE_CODE.duplicateKey,
				`$[${index}]._key`,
				`Portable Text top-level key "${value._key}" is duplicated`,
			);
		}
		seen.add(value._key);
	}
}

function listSignature(value: unknown) {
	if (
		!isPortableTextRecord(value)
		|| value._type !== "block"
		|| value.listItem === undefined
	) return null;
	return {
		style: value.listItem,
		level: value.level ?? 1,
	};
}

function convertList(
	values: unknown[],
	startIndex: number,
	issues: RichTextIssue[],
) {
	const first = values[startIndex];
	const signature = listSignature(first);
	if (!isPortableTextRecord(first) || signature === null) {
		throw new Error("convertList requires a Portable Text list block");
	}
	const path = `$[${startIndex}]`;
	if (signature.style !== "bullet" && signature.style !== "number") {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.unsupportedPortableTextList,
			`${path}.listItem`,
			`Portable Text list style "${String(signature.style)}" is unsupported`,
		);
	}
	if (signature.level !== 1) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.unsupportedPortableTextList,
			`${path}.level`,
			"Nested Portable Text lists are outside rich-text schema version 1",
		);
	}

	const items: RichTextListItem[] = [];
	let firstItemKey: string | null = null;
	let nextIndex = startIndex;
	while (nextIndex < values.length) {
		const candidate = values[nextIndex];
		const candidateSignature = listSignature(candidate);
		if (
			!isPortableTextRecord(candidate)
			|| candidateSignature === null
			|| candidateSignature.style !== signature.style
			|| candidateSignature.level !== signature.level
		) break;
		const candidatePath = `$[${nextIndex}]`;
		assertPortableFields(
			candidate,
			new Set(["_key", "_type", "style", "children", "markDefs", "listItem", "level"]),
			candidatePath,
			issues,
		);
		if (candidate.style !== undefined && candidate.style !== "normal") {
			addPortableTextIssue(
				issues,
				RICH_TEXT_ISSUE_CODE.unsupportedPortableTextStyle,
				`${candidatePath}.style`,
				"List items must use the normal Portable Text style",
			);
		}
		const key = readPortableKey(candidate._key, `${candidatePath}._key`, issues);
		const children = convertTextBlockContent(candidate, candidatePath, issues);
		if (nextIndex === startIndex) firstItemKey = key;
		if (key !== null) items.push({ key, children });
		nextIndex += 1;
	}

	const style = signature.style === "number" ? "number" : "bullet";
	const block: RichTextBlock = {
		type: "list",
		key: firstItemKey ?? `invalid-${startIndex}`,
		style,
		items,
	};
	return { block, nextIndex };
}

function convertTextBlock(
	value: Record<string, unknown>,
	index: number,
	issues: RichTextIssue[],
) {
	const path = `$[${index}]`;
	assertPortableFields(
		value,
		new Set(["_key", "_type", "style", "children", "markDefs"]),
		path,
		issues,
	);
	const key = readPortableKey(value._key, `${path}._key`, issues);
	const children = convertTextBlockContent(value, path, issues);
	const style = value.style ?? "normal";
	if (style === "normal") {
		return {
			type: "paragraph",
			key: key ?? `invalid-${index}`,
			children,
		} satisfies RichTextBlock;
	}
	if (style === "h2" || style === "h3" || style === "h4") {
		return {
			type: "heading",
			key: key ?? `invalid-${index}`,
			level: Number(style.slice(1)) as 2 | 3 | 4,
			children,
		} satisfies RichTextBlock;
	}
	if (style === "blockquote") {
		return {
			type: "quote",
			key: key ?? `invalid-${index}`,
			children,
		} satisfies RichTextBlock;
	}
	addPortableTextIssue(
		issues,
		RICH_TEXT_ISSUE_CODE.unsupportedPortableTextStyle,
		`${path}.style`,
		`Portable Text style "${String(style)}" is unsupported; body H1 is never rewritten silently`,
	);
	return null;
}

function readOptionalImageText(
	value: unknown,
	path: string,
	issues: RichTextIssue[],
) {
	if (value === undefined || value === null) return undefined;
	return readPortableText(value, path, issues) ?? undefined;
}

function convertImage(
	value: Record<string, unknown>,
	index: number,
	options: PortableTextAdapterOptions,
	issues: RichTextIssue[],
) {
	const path = `$[${index}]`;
	assertPortableFields(
		value,
		new Set(["_key", "_type", "asset", "alt", "caption", "crop", "hotspot"]),
		path,
		issues,
	);
	for (const field of ["crop", "hotspot"] as const) {
		if (value[field] !== undefined && value[field] !== null) {
			addPortableTextIssue(
				issues,
				RICH_TEXT_ISSUE_CODE.unsupportedPortableTextField,
				`${path}.${field}`,
				`Portable Text ${field} metadata is not part of the provider-neutral content contract`,
			);
		}
	}
	const key = readPortableKey(value._key, `${path}._key`, issues);
	if (!isPortableTextRecord(value.asset)) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.invalidShape,
			`${path}.asset`,
			"Expected an image asset reference",
		);
		return null;
	}
	assertPortableFields(value.asset, new Set(["_type", "_ref"]), `${path}.asset`, issues);
	const isReference = value.asset._type === "reference";
	if (!isReference) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.invalidShape,
			`${path}.asset._type`,
			"Portable Text image assets must use a Sanity reference object",
		);
	}
	const sourceRef = readPortableText(value.asset._ref, `${path}.asset._ref`, issues);
	const isImageReference = sourceRef?.startsWith("image-") ?? false;
	if (sourceRef !== null && !isImageReference) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.invalidShape,
			`${path}.asset._ref`,
			"Portable Text image assets must reference a Sanity image asset",
		);
	}
	const assetId = isReference && isImageReference && sourceRef !== null
		? options.imageAssetIds[sourceRef]
		: undefined;
	if (isReference && isImageReference && sourceRef !== null && !assetId) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.unresolvedImageAsset,
			`${path}.asset._ref`,
			`Image asset "${sourceRef}" has no target media mapping`,
		);
	}
	const altText = readOptionalImageText(value.alt, `${path}.alt`, issues);
	const caption = readOptionalImageText(value.caption, `${path}.caption`, issues);
	if (key === null || !assetId) return null;
	return {
		type: "image",
		key,
		assetId,
		...(altText === undefined ? {} : { altText }),
		...(caption === undefined ? {} : { caption }),
	} satisfies RichTextBlock;
}

/**
 * Convert the deliberately supported Portable Text subset without retaining
 * Sanity document shapes. Any unsupported or unresolved source data makes the
 * result unusable instead of being dropped silently.
 */
export function convertPortableText(
	value: unknown,
	options: PortableTextAdapterOptions,
): PortableTextConversionResult {
	const issues: RichTextIssue[] = [];
	if (!Array.isArray(value)) {
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.invalidShape,
			"$",
			"Expected Portable Text blocks",
		);
		return { document: null, issues };
	}
	assertUniquePortableTextKeys(value, issues);

	const blocks: RichTextBlock[] = [];
	let index = 0;
	while (index < value.length) {
		const node = value[index];
		const path = `$[${index}]`;
		if (!isPortableTextRecord(node) || typeof node._type !== "string") {
			addPortableTextIssue(
				issues,
				RICH_TEXT_ISSUE_CODE.invalidShape,
				path,
				"Expected a Portable Text node",
			);
			index += 1;
			continue;
		}
		if (node._type === "block") {
			if (node.listItem !== undefined) {
				const converted = convertList(value, index, issues);
				blocks.push(converted.block);
				index = converted.nextIndex;
				continue;
			}
			const block = convertTextBlock(node, index, issues);
			if (block) blocks.push(block);
			index += 1;
			continue;
		}
		if (node._type === "image") {
			const block = convertImage(node, index, options, issues);
			if (block) blocks.push(block);
			index += 1;
			continue;
		}
		addPortableTextIssue(
			issues,
			RICH_TEXT_ISSUE_CODE.unsupportedPortableTextNode,
			`${path}._type`,
			`Portable Text node "${node._type}" is unsupported`,
		);
		index += 1;
	}

	const inspected = inspectRichTextDocument(
		{ version: RICH_TEXT_SCHEMA_VERSION, blocks },
		options.mode ?? "draft",
	);
	issues.push(...inspected.issues);
	return {
		document: hasRichTextErrors(issues) ? null : inspected.document,
		issues,
	};
}
