import type { Doc } from "$convex/dataModel";
import { env } from "$env/dynamic/private";

export type LumaPrintsConnection = Readonly<
	Pick<
		Doc<"lumaprintsConnections">,
		"version" | "connectionRef" | "tenantId" | "storeId" | "environment"
	>
>;

const MAX_REGISTRY_BYTES = 64 * 1024;
const MAX_CONNECTIONS = 100;
const CONNECTION_REF = /^lp_[A-Za-z0-9_-]{8,80}$/;
const TENANT_ID = /^tenant_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const CREDENTIAL_REF = /^[A-Z][A-Z0-9_]{0,63}$/;

function unavailable(): never {
	throw new Error("LumaPrints connection configuration is unavailable");
}

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isConnection(value: unknown): value is LumaPrintsConnection {
	return (
		object(value) &&
		value.version === 1 &&
		typeof value.connectionRef === "string" &&
		CONNECTION_REF.test(value.connectionRef) &&
		typeof value.tenantId === "string" &&
		TENANT_ID.test(value.tenantId) &&
		typeof value.storeId === "number" &&
		Number.isSafeInteger(value.storeId) &&
		value.storeId > 0 &&
		(value.environment === "sandbox" || value.environment === "production")
	);
}

function credential(value: string | undefined, key = false): string {
	if (!value || value.length > 512 || !/^[\x21-\x7e]+$/.test(value) || (key && value.includes(":")))
		unavailable();
	return value;
}

function readRegistry() {
	const raw = env.LUMAPRINTS_CONNECTIONS;
	if (!raw || Buffer.byteLength(raw, "utf8") > MAX_REGISTRY_BYTES) unavailable();
	let registry: unknown;
	try {
		registry = JSON.parse(raw);
	} catch {
		unavailable();
	}
	if (
		!object(registry) ||
		Object.keys(registry).length !== 2 ||
		registry.version !== 1 ||
		!Array.isArray(registry.connections) ||
		registry.connections.length < 1 ||
		registry.connections.length > MAX_CONNECTIONS
	)
		unavailable();

	const entries: Array<LumaPrintsConnection & { credentialRef: string }> = [];
	const references = new Set<string>();
	const credentialReferences = new Set<string>();
	for (const entry of registry.connections) {
		if (
			!isConnection(entry) ||
			Object.keys(entry).length !== 6 ||
			!("credentialRef" in entry) ||
			typeof entry.credentialRef !== "string" ||
			!CREDENTIAL_REF.test(entry.credentialRef) ||
			references.has(entry.connectionRef) ||
			credentialReferences.has(entry.credentialRef)
		)
			unavailable();
		references.add(entry.connectionRef);
		credentialReferences.add(entry.credentialRef);
		entries.push({ ...entry, credentialRef: entry.credentialRef });
	}
	return entries;
}

/** Resolve a saved identity, never a site's current selection or a central fallback. */
export function resolveLumaPrintsConfiguration(connection: LumaPrintsConnection) {
	if (!isConnection(connection)) unavailable();
	const entries = readRegistry();
	const selected = entries.find((entry) => entry.connectionRef === connection.connectionRef);
	if (
		!selected ||
		selected.tenantId !== connection.tenantId ||
		selected.storeId !== connection.storeId ||
		selected.environment !== connection.environment
	)
		unavailable();
	const prefix = `LUMAPRINTS_CONNECTION_${selected.credentialRef}`;
	const apiKey = credential(env[`${prefix}_API_KEY`], true);
	const apiSecret = credential(env[`${prefix}_API_SECRET`]);
	// Catch accidental cross-client credential copies without making another client's
	// missing secret an outage for this connection. Same-tenant history may share keys.
	for (const entry of entries) {
		if (entry.tenantId === selected.tenantId && entry.environment === selected.environment)
			continue;
		const otherPrefix = `LUMAPRINTS_CONNECTION_${entry.credentialRef}`;
		if (env[`${otherPrefix}_API_KEY`] === apiKey && env[`${otherPrefix}_API_SECRET`] === apiSecret)
			unavailable();
	}
	return Object.freeze({
		baseUrl:
			selected.environment === "sandbox"
				? "https://us.api-sandbox.lumaprints.com"
				: "https://us.api.lumaprints.com",
		storeId: selected.storeId,
		apiKey,
		apiSecret,
	});
}

/** Inbound credentials are independent of outbound API access and current selection. */
export function resolveLumaPrintsWebhookConfiguration(connectionRef?: string) {
	if (connectionRef !== undefined && !CONNECTION_REF.test(connectionRef)) unavailable();
	// Unconfigured legacy hosts keep their existing central entry point.
	const entries = connectionRef === undefined && !env.LUMAPRINTS_CONNECTIONS ? [] : readRegistry();
	const selected = entries.find((entry) => entry.connectionRef === connectionRef);
	if (connectionRef !== undefined && !selected) unavailable();
	const prefix = selected ? `LUMAPRINTS_CONNECTION_${selected.credentialRef}` : "LUMAPRINTS";
	const username = selected
		? credential(env[`${prefix}_WEBHOOK_USERNAME`], true)
		: env.LUMAPRINTS_WEBHOOK_USERNAME;
	const password = selected
		? credential(env[`${prefix}_WEBHOOK_PASSWORD`])
		: env.LUMAPRINTS_WEBHOOK_PASSWORD;
	const old = env[`${prefix}_WEBHOOK_PASSWORD_PREVIOUS`];
	const previousPassword = selected && old !== undefined ? credential(old) : old;
	const passwords = [password, previousPassword].filter((value) => value !== undefined);
	// Reject overlap in both directions, including central intake and rotation windows.
	for (const otherPrefix of [
		"LUMAPRINTS",
		...entries.map((entry) => `LUMAPRINTS_CONNECTION_${entry.credentialRef}`),
	].filter((candidate) => candidate !== prefix)) {
		if (
			env[`${otherPrefix}_WEBHOOK_USERNAME`] === username &&
			passwords.some(
				(value) =>
					value === env[`${otherPrefix}_WEBHOOK_PASSWORD`] ||
					value === env[`${otherPrefix}_WEBHOOK_PASSWORD_PREVIOUS`],
			)
		)
			unavailable();
	}
	const connection = selected
		? Object.freeze({
				version: selected.version,
				connectionRef: selected.connectionRef,
				tenantId: selected.tenantId,
				storeId: selected.storeId,
				environment: selected.environment,
			})
		: undefined;
	return Object.freeze({ connection, username, password, previousPassword });
}
