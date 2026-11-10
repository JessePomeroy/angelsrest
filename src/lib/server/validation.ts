const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(email: string): boolean {
	return EMAIL_REGEX.test(email);
}

export function trimString(
	value: string | undefined | null,
	maxLength: number,
): string | undefined {
	if (value == null) return undefined;
	return String(value).trim().slice(0, maxLength);
}

/** A non-null, non-array object whose properties can be inspected. */
export function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
