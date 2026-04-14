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
	if (Number.isNaN(num) || num < 0) {
		throw new Error(`${fieldName} must be a positive number`);
	}
	return num;
}
