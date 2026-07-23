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

export function parseOptionalTenantSecretRegistry(raw: string | undefined) {
	return raw === undefined
		? new Map<string, readonly string[]>()
		: parseTenantSecretRegistry(raw);
}

const AUTHORITY_BEARING_SCALAR_ENV_NAMES = [
	"BETTER_AUTH_SECRET",
	"AUTH_GOOGLE_SECRET",
	"STRIPE_SECRET_KEY",
	"WEBHOOK_SECRET",
	"ORDER_LOOKUP_SECRET",
] as const;

/**
 * Parse every authority-bearing Convex runtime role together so one reused
 * credential disables every affected entry point, including legacy routes.
 * Registries are optional here; each caller separately requires its own role.
 */
export function purposeScopedServerRoleConfiguration() {
	const registries = {
		host: parseOptionalTenantSecretRegistry(
			process.env.CATALOG_PRIVATE_ASSET_EDITOR_HOST_JOURNAL_SECRETS,
		),
		inspector: parseOptionalTenantSecretRegistry(
			process.env.CATALOG_PRIVATE_ASSET_EDITOR_INSPECTION_CLAIM_SECRETS,
		),
		workerControl: parseOptionalTenantSecretRegistry(
			process.env.CATALOG_PRIVATE_EDITOR_UPLOAD_CONTROL_SECRETS,
		),
		storageReceipt: parseOptionalTenantSecretRegistry(
			process.env.CATALOG_PRIVATE_ASSET_STORAGE_RECEIPT_SECRETS,
		),
		inspectionReceipt: parseOptionalTenantSecretRegistry(
			process.env.CATALOG_PRIVATE_ASSET_INSPECTION_RECEIPT_SECRETS,
		),
		deletion: parseOptionalTenantSecretRegistry(
			process.env.CMS_MEDIA_DELETION_COMPLETION_SECRETS,
		),
	};
	const parsed = Object.values(registries);
	if (parsed.some((registry) => registry === null)) return null;
	const configured = parsed as ReadonlyMap<string, readonly string[]>[];
	if (!tenantSecretRegistriesAreDisjoint(...configured)) return null;
	const registrySecrets = new Set(configured.flatMap((registry) => [...registry.values()].flat()));
	const scalarSecrets = AUTHORITY_BEARING_SCALAR_ENV_NAMES
		.map((name) => process.env[name])
		.filter((secret): secret is string => secret !== undefined);
	if (
		new Set(scalarSecrets).size !== scalarSecrets.length
		|| scalarSecrets.some((secret) => registrySecrets.has(secret))
	) return null;
	return registries as { [Role in keyof typeof registries]: ReadonlyMap<string, readonly string[]> };
}

export function purposeScopedServerRolesAreDisjoint() {
	return purposeScopedServerRoleConfiguration() !== null;
}

export async function tenantForSecretFixed(
	registry: ReadonlyMap<string, readonly string[]>,
	supplied: string,
) {
	const valid = isServerSecretCandidate(supplied);
	const candidates: Array<{ siteUrl: string | null; configured: boolean; value: string }> = [];
	for (const [siteUrl, secrets] of registry) {
		candidates.push({ siteUrl, configured: true, value: secrets[0] ?? "" });
		candidates.push({ siteUrl, configured: secrets.length > 1, value: secrets[1] ?? "" });
	}
	while (candidates.length < TENANT_LIMIT * SECRETS_PER_TENANT_LIMIT) {
		candidates.push({ siteUrl: null, configured: false, value: "" });
	}
	const suppliedDigest = await digest(valid ? supplied : "");
	const candidateDigests = await Promise.all(candidates.map(({ value }) => digest(value)));
	const matches = new Set<string>();
	for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex += 1) {
		const candidate = candidates[candidateIndex];
		const candidateDigest = candidateDigests[candidateIndex];
		if (!candidate || !candidateDigest) continue;
		let difference = 0;
		for (let byteIndex = 0; byteIndex < suppliedDigest.byteLength; byteIndex += 1) {
			difference |= suppliedDigest[byteIndex] ^ candidateDigest[byteIndex];
		}
		if (candidate.configured && candidate.siteUrl && difference === 0) {
			matches.add(candidate.siteUrl);
		}
	}
	return valid && matches.size === 1 ? [...matches][0]! : null;
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
