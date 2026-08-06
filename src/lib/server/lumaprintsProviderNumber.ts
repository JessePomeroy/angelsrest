const LUMAPRINTS_PROVIDER_NUMBER = /^[1-9]\d{0,63}$/;

/** Normalize the provider's documented numeric form to its stored decimal string form. */
export function normalizeLumaPrintsProviderNumber(value: unknown): string | null {
	if (typeof value === "number") {
		return Number.isSafeInteger(value) && value > 0 ? String(value) : null;
	}
	return typeof value === "string" && LUMAPRINTS_PROVIDER_NUMBER.test(value) ? value : null;
}
