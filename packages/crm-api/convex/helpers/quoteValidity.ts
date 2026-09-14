const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Convert a quote's date-only `validUntil` value into its exclusive UTC
 * boundary. A quote dated 2026-09-01 remains actionable through that entire
 * UTC calendar date and closes exactly at 2026-09-02T00:00:00.000Z.
 *
 * UTC is deliberate: tenants do not currently store an authoritative business
 * timezone, so this avoids server-region and browser-locale drift. Invalid or
 * non-date-only values fail closed and return null.
 */
export function quoteValidUntilExclusiveUtcMs(validUntil: string): number | null {
	const match = DATE_ONLY_PATTERN.exec(validUntil);
	if (!match) return null;

	const year = Number(match[1]);
	const month = Number(match[2]);
	const day = Number(match[3]);
	const start = Date.UTC(year, month - 1, day);
	const parsed = new Date(start);
	if (
		parsed.getUTCFullYear() !== year ||
		parsed.getUTCMonth() !== month - 1 ||
		parsed.getUTCDate() !== day
	) {
		return null;
	}

	return start + DAY_MS;
}
/** A missing validity date is open-ended; malformed dates fail closed. */
export function quoteAcceptanceIsOpen(validUntil: string | undefined, now = Date.now()) {
	if (validUntil === undefined) return true;
	const closesAt = quoteValidUntilExclusiveUtcMs(validUntil);
	return closesAt !== null && now < closesAt;
}
