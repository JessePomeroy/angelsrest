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

export function requireString(value: unknown, fieldName: string, maxLength = 255): string {
	if (typeof value !== "string" || !value.trim()) {
		throw new Error(`${fieldName} is required`);
	}
	return value.trim().slice(0, maxLength);
}

export function validatePositiveNumber(value: unknown, fieldName: string): number {
	const num = Number(value);
	// Audit L18: previously this allowed 0 despite being named "positive".
	// Tightened to `n > 0` to match the name — the zero-allowing variant
	// would be `validateNonNegativeNumber` if ever needed.
	if (Number.isNaN(num) || num <= 0) {
		throw new Error(`${fieldName} must be a positive number`);
	}
	return num;
}
