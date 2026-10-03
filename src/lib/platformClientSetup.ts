export const MAX_CLIENT_SETUP_PLAN_BYTES = 16_384;

export interface ClientSetupPlan {
	version: 1;
	kind: "client-setup";
	identity: {
		repository: string;
		siteUrl: string;
		expectedTenantId: string | null;
		environmentId: string;
		sourceRevision: string | null;
		sourceFingerprint: string;
		contractFingerprint: string;
	};
	target: { publicOrigin: string; convexUrl: string; convexSiteUrl: string };
}
export interface PlatformClientIntent {
	name: string;
	email: string;
	siteUrl: string;
	tier: "basic" | "full";
}
export const CLIENT_SETUP_CONFLICT_LABELS = {
	name: "Business name",
	email: "Client admin email",
	tier: "Access tier",
	siteUrl: "Website ownership",
	tenantIdentity: "Stored tenant identity",
	expectedTenantId: "Expected tenant identity",
	role: "Client role",
	offboarding: "Client offboarding",
	adminIdentity: "Administrator membership",
};
export type ClientSetupConflict = keyof typeof CLIENT_SETUP_CONFLICT_LABELS;
export type ClientSetupStatus =
	| { kind: "absent"; siteUrl: string }
	| { kind: "matching"; siteUrl: string; clientId: string; tenantId: string }
	| {
			kind: "conflict";
			siteUrl: string;
			clientId: string | null;
			tenantId: string | null;
			conflicts: ClientSetupConflict[];
	  };

function record(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
function keys(value: unknown, expected: string[]): value is Record<string, unknown> {
	return (
		record(value) &&
		Object.keys(value).length === expected.length &&
		expected.every((key) => Object.hasOwn(value, key))
	);
}
function tenantId(value: unknown): value is string {
	return (
		typeof value === "string" &&
		/^tenant_[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(value)
	);
}
function hostname(value: unknown): value is string {
	return (
		typeof value === "string" &&
		value.length <= 253 &&
		!value.startsWith("www.") &&
		value.split(".").length > 1 &&
		!value.split(".").every((label) => /^\d+$/.test(label)) &&
		value
			.split(".")
			.every((label) => label.length <= 63 && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))
	);
}
function httpsOrigin(value: unknown): value is string {
	if (typeof value !== "string" || value.length > 2000) return false;
	try {
		const url = new URL(value);
		return url.protocol === "https:" && !url.username && !url.password && url.origin === value;
	} catch {
		return false;
	}
}

/** Public operator intent only; a prepared attachment is not an authorization token. */
export function parseClientSetupPlan(value: unknown): ClientSetupPlan | null {
	if (
		!keys(value, ["version", "kind", "identity", "target"]) ||
		value.version !== 1 ||
		value.kind !== "client-setup"
	)
		return null;
	const identity = value.identity;
	const target = value.target;
	if (
		!keys(identity, [
			"repository",
			"siteUrl",
			"expectedTenantId",
			"environmentId",
			"sourceRevision",
			"sourceFingerprint",
			"contractFingerprint",
		]) ||
		!keys(target, ["publicOrigin", "convexUrl", "convexSiteUrl"])
	)
		return null;
	if (
		typeof identity.repository !== "string" ||
		identity.repository.length > 200 ||
		!/^[A-Za-z0-9][A-Za-z0-9-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/.test(identity.repository) ||
		!hostname(identity.siteUrl) ||
		!(identity.expectedTenantId === null || tenantId(identity.expectedTenantId)) ||
		typeof identity.environmentId !== "string" ||
		!/^[a-z][a-z0-9-]{0,79}$/.test(identity.environmentId) ||
		!(
			identity.sourceRevision === null ||
			(typeof identity.sourceRevision === "string" &&
				/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(identity.sourceRevision))
		) ||
		typeof identity.sourceFingerprint !== "string" ||
		!/^[a-f0-9]{64}$/.test(identity.sourceFingerprint) ||
		typeof identity.contractFingerprint !== "string" ||
		!/^[a-f0-9]{64}$/.test(identity.contractFingerprint) ||
		!httpsOrigin(target.publicOrigin) ||
		!httpsOrigin(target.convexUrl) ||
		!httpsOrigin(target.convexSiteUrl)
	)
		return null;
	const cloud = new URL(target.convexUrl).hostname;
	if (
		cloud.endsWith(".convex.cloud") &&
		new URL(target.convexSiteUrl).hostname !== cloud.replace(/\.convex\.cloud$/, ".convex.site")
	)
		return null;
	return {
		version: 1,
		kind: "client-setup",
		identity: {
			repository: identity.repository,
			siteUrl: identity.siteUrl,
			expectedTenantId: identity.expectedTenantId,
			environmentId: identity.environmentId,
			sourceRevision: identity.sourceRevision,
			sourceFingerprint: identity.sourceFingerprint,
			contractFingerprint: identity.contractFingerprint,
		},
		target: {
			publicOrigin: target.publicOrigin,
			convexUrl: target.convexUrl,
			convexSiteUrl: target.convexSiteUrl,
		},
	};
}

export function parseClientSetupStatus(value: unknown, siteUrl: string): ClientSetupStatus | null {
	if (!record(value) || value.siteUrl !== siteUrl) return null;
	if (value.kind === "absent") return { kind: "absent", siteUrl };
	if (
		value.kind === "matching" &&
		typeof value.clientId === "string" &&
		value.clientId &&
		tenantId(value.tenantId)
	) {
		return { kind: "matching", siteUrl, clientId: value.clientId, tenantId: value.tenantId };
	}
	if (
		value.kind === "conflict" &&
		(value.clientId === null || typeof value.clientId === "string") &&
		(value.tenantId === null || typeof value.tenantId === "string") &&
		Array.isArray(value.conflicts) &&
		value.conflicts.length > 0 &&
		value.conflicts.every(
			(key): key is ClientSetupConflict =>
				typeof key === "string" && Object.hasOwn(CLIENT_SETUP_CONFLICT_LABELS, key),
		)
	) {
		return {
			kind: "conflict",
			siteUrl,
			clientId: value.clientId,
			tenantId: value.tenantId,
			conflicts: value.conflicts,
		};
	}
	return null;
}
