import {
	RICH_TEXT_ISSUE_CODE,
	RICH_TEXT_LIMITS,
	type RichTextIssue,
	type RichTextIssueCode,
	type RichTextMark,
	type RichTextSpan,
	type RichTextValidationMode,
} from "./richTextContract";

const KEY_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]*$/;
const MARK_ORDER: Record<RichTextMark["type"], number> = {
	strong: 0,
	emphasis: 1,
	link: 2,
};

export type ValidationContext = {
	issues: RichTextIssue[];
	totalCharacters: number;
	totalLimitReported: boolean;
	mode: RichTextValidationMode;
};

export function createValidationContext(
	mode: RichTextValidationMode,
): ValidationContext {
	return {
		issues: [],
		totalCharacters: 0,
		totalLimitReported: false,
		mode,
	};
}

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function addIssue(
	ctx: ValidationContext,
	code: RichTextIssueCode,
	path: string,
	message: string,
	severity: RichTextIssue["severity"] = "error",
) {
	ctx.issues.push({ code, path, message, severity });
}

export function assertOnlyKeys(
	value: Record<string, unknown>,
	allowed: ReadonlySet<string>,
	path: string,
	ctx: ValidationContext,
) {
	for (const key of Object.keys(value)) {
		if (!allowed.has(key)) {
			addIssue(
				ctx,
				RICH_TEXT_ISSUE_CODE.unsupportedField,
				`${path}.${key}`,
				`Field "${key}" is not part of the rich-text contract`,
			);
		}
	}
}

function addCharacters(value: string, path: string, ctx: ValidationContext) {
	ctx.totalCharacters += value.length;
	if (
		ctx.totalCharacters > RICH_TEXT_LIMITS.totalCharacters
		&& !ctx.totalLimitReported
	) {
		ctx.totalLimitReported = true;
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.limitExceeded,
			path,
			`Rich text cannot contain more than ${RICH_TEXT_LIMITS.totalCharacters} characters`,
		);
	}
}

export function readKey(
	value: unknown,
	path: string,
	ctx: ValidationContext,
) {
	if (typeof value !== "string" || value.length === 0) {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.missingKey, path, "A stable key is required");
		return null;
	}
	if (!isValidRichTextKey(value)) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.invalidKey,
			path,
			`Keys must be ${RICH_TEXT_LIMITS.keyCharacters} characters or fewer and use letters, numbers, dot, underscore, colon, or hyphen`,
		);
		return null;
	}
	return value;
}

export function isValidRichTextKey(value: string) {
	return value.length <= RICH_TEXT_LIMITS.keyCharacters
		&& value === value.trim()
		&& KEY_PATTERN.test(value);
}

export function readBoundedString(
	value: unknown,
	path: string,
	maximum: number,
	ctx: ValidationContext,
) {
	if (typeof value !== "string") {
		addIssue(ctx, RICH_TEXT_ISSUE_CODE.invalidShape, path, "Expected text");
		return null;
	}
	if (value.length > maximum) {
		addIssue(
			ctx,
			RICH_TEXT_ISSUE_CODE.limitExceeded,
			path,
			`Text cannot contain more than ${maximum} characters`,
		);
	}
	addCharacters(value, path, ctx);
	return value;
}

export function readOptionalBoundedString(
	value: unknown,
	path: string,
	maximum: number,
	ctx: ValidationContext,
) {
	if (value === undefined) return undefined;
	return readBoundedString(value, path, maximum, ctx) ?? undefined;
}

export function assertUniqueKeys(
	keys: Array<string | null>,
	path: string,
	ctx: ValidationContext,
) {
	const seen = new Set<string>();
	for (const key of keys) {
		if (key === null) continue;
		if (seen.has(key)) {
			addIssue(
				ctx,
				RICH_TEXT_ISSUE_CODE.duplicateKey,
				path,
				`Key "${key}" is duplicated`,
			);
		}
		seen.add(key);
	}
}

export function addMissingContentIssue(
	ctx: ValidationContext,
	path: string,
	message: string,
) {
	addIssue(
		ctx,
		RICH_TEXT_ISSUE_CODE.missingContent,
		path,
		message,
		ctx.mode === "publish" ? "error" : "warning",
	);
}

export function isSafeRichTextUrl(href: string) {
	const normalized = href.trim();
	if (!normalized || normalized.length > RICH_TEXT_LIMITS.urlCharacters) {
		return false;
	}
	if (normalized.startsWith("#")) return !normalized.includes(" ");
	if (normalized.startsWith("/")) {
		return !normalized.startsWith("//") && !normalized.includes("\\");
	}
	try {
		const parsed = new URL(normalized);
		return ["https:", "http:", "mailto:", "tel:"].includes(parsed.protocol);
	} catch {
		return false;
	}
}

export function sortRichTextMarks(marks: RichTextMark[]) {
	return marks.sort((left, right) => MARK_ORDER[left.type] - MARK_ORDER[right.type]);
}

export function spansToText(spans: RichTextSpan[]) {
	return spans.map((span) => span.text).join("").trim();
}
