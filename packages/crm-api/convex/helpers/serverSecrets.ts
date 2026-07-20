const encoder = new TextEncoder();
const TENANT_LIMIT = 100;
const SECRETS_PER_TENANT_LIMIT = 2;
const SECRET_MIN_LENGTH = 32;
const SECRET_MAX_LENGTH = 512;

export function isServerSecretCandidate(value: string) {
	return value.length >= SECRET_MIN_LENGTH
		&& value.length <= SECRET_MAX_LENGTH
		&& value === value.trim();
}

export function isTenantSiteSegment(value: unknown): value is string {
	return typeof value === "string"
		&& value.length > 0
		&& value.length <= 253
		&& value === value.trim()
		&& value !== "."
		&& value !== ".."
		&& !value.includes("/")
		&& !value.includes("\\");
}

async function digest(value: string) {
	return new Uint8Array(await crypto.subtle.digest("SHA-256", encoder.encode(value)));
}

export async function constantTimeSecretEquals(left: string, right: string) {
	const [a, b] = await Promise.all([digest(left), digest(right)]);
	let difference = 0;
	for (let index = 0; index < a.byteLength; index += 1) {
		difference |= a[index] ^ b[index];
	}
	return difference === 0;
}

export function parseTenantSecretRegistry(
	raw: string | undefined,
): ReadonlyMap<string, readonly string[]> | null {
	if (!raw) return null;
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw);
	} catch {
		return null;
	}
	if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;

	const entries = Object.entries(parsed);
	if (entries.length === 0 || entries.length > TENANT_LIMIT) return null;
	const registry = new Map<string, readonly string[]>();
	const registeredSecrets = new Set<string>();
	for (const [siteUrl, secrets] of entries) {
		if (
			!isTenantSiteSegment(siteUrl)
			|| !Array.isArray(secrets)
			|| secrets.length === 0
			|| secrets.length > SECRETS_PER_TENANT_LIMIT
			|| secrets.some((secret) => (
				typeof secret !== "string"
					|| !isServerSecretCandidate(secret)
			))
			|| new Set(secrets).size !== secrets.length
		) return null;
		const validatedSecrets = secrets as string[];
		if (validatedSecrets.some((secret) => registeredSecrets.has(secret))) return null;
		for (const secret of validatedSecrets) registeredSecrets.add(secret);
		registry.set(siteUrl, validatedSecrets);
	}
	return registry;
}

export async function tenantSecretMatches(
	registry: ReadonlyMap<string, readonly string[]>,
	siteUrl: string,
	supplied: string,
) {
	if (!isServerSecretCandidate(supplied)) return false;
	let matches = false;
	for (const expected of registry.get(siteUrl) ?? []) {
		if (await constantTimeSecretEquals(supplied, expected)) matches = true;
	}
	return matches;
}

/**
 * Purpose-scoped server credentials must not silently collapse into one broad
 * capability. Each parsed registry already rejects reuse across its tenants;
 * this closes reuse across independent producer roles as well.
 */
export function tenantSecretRegistriesAreDisjoint(
	...registries: readonly ReadonlyMap<string, readonly string[]>[]
) {
	const seen = new Set<string>();
	for (const registry of registries) {
		for (const secrets of registry.values()) {
			for (const secret of secrets) {
				if (seen.has(secret)) return false;
				seen.add(secret);
			}
		}
	}
	return true;
}
