import type { Doc } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";

type TenantReference =
	| { tenantId: string }
	| { siteUrl: string }
	| { origin: string };

type VerificationMethod = "platform_client_site_url" | "operator";

type TenantContext = {
	tenantId: string | null;
	siteUrl: string;
	client: Doc<"platformClients">;
	resolvedBy: "tenantId" | "alias" | "legacy_siteUrl";
};

function normalizeDomain(value: string) {
	const trimmed = value.trim().replace(/\/+$/, "");
	if (!trimmed) throw new Error("Tenant domain cannot be empty");
	try {
		return new URL(
			trimmed.includes("://") ? trimmed : `https://${trimmed}`,
		).hostname.toLowerCase();
	} catch {
		throw new Error(`Invalid tenant domain: ${value}`);
	}
}

function normalizeOrigin(value: string) {
	try {
		return new URL(value.trim()).origin.toLowerCase();
	} catch {
		throw new Error(`Invalid tenant origin: ${value}`);
	}
}

function aliasesForSiteUrl(siteUrl: string) {
	const hostname = normalizeDomain(siteUrl);
	const apex = hostname.replace(/^www\./, "");
	const domains = Array.from(new Set([apex, `www.${apex}`]));
	return [
		...domains.map((value) => ({ kind: "domain" as const, value })),
		...domains.map((domain) => ({
			kind: "origin" as const,
			value: `https://${domain}`,
		})),
	];
}

async function clientForTenantId(
	ctx: Pick<QueryCtx, "db">,
	tenantId: string,
) {
	return await ctx.db
		.query("platformClients")
		.withIndex("by_tenantId", (q) => q.eq("tenantId", tenantId))
		.unique();
}

/** Resolve stable tenant identity while retaining a bounded legacy-domain path. */
export async function resolveTenantContext(
	ctx: Pick<QueryCtx, "db">,
	reference: TenantReference,
): Promise<TenantContext | null> {
	if ("tenantId" in reference) {
		const client = await clientForTenantId(ctx, reference.tenantId);
		return client
			? {
					tenantId: reference.tenantId,
					siteUrl: client.siteUrl,
					client,
					resolvedBy: "tenantId",
				}
			: null;
	}

	const [kind, value] =
		"origin" in reference
			? (["origin", normalizeOrigin(reference.origin)] as const)
			: (["domain", normalizeDomain(reference.siteUrl)] as const);
	const alias = await ctx.db
		.query("tenantAliases")
		.withIndex("by_kind_and_value", (q) =>
			q.eq("kind", kind).eq("value", value),
		)
		.unique();
	if (alias) {
		const client = await clientForTenantId(ctx, alias.tenantId);
		if (!client) throw new Error("Tenant alias points to a missing tenant");
		return {
			tenantId: alias.tenantId,
			siteUrl: client.siteUrl,
			client,
			resolvedBy: "alias",
		};
	}

	const candidates = Array.from(
		new Set([
			"siteUrl" in reference ? reference.siteUrl.trim().replace(/\/+$/, "") : "",
			value,
			normalizeDomain(value),
			...aliasesForSiteUrl(value).map(({ value: alias }) => alias),
		]),
	).filter(Boolean);
	for (const siteUrl of candidates) {
		const client = await ctx.db
			.query("platformClients")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.unique();
		if (client) {
			return {
				tenantId: client.tenantId ?? null,
				siteUrl: client.siteUrl,
				client,
				resolvedBy: "legacy_siteUrl",
			};
		}
	}
	return null;
}

async function ensureAlias(
	ctx: Pick<MutationCtx, "db">,
	tenantId: string,
	kind: "domain" | "origin",
	value: string,
	verificationMethod: VerificationMethod,
) {
	const existing = await ctx.db
		.query("tenantAliases")
		.withIndex("by_kind_and_value", (q) =>
			q.eq("kind", kind).eq("value", value),
		)
		.unique();
	if (existing) {
		if (existing.tenantId !== tenantId) {
			throw new Error(`Tenant ${kind} alias is already claimed: ${value}`);
		}
		return false;
	}
	await ctx.db.insert("tenantAliases", {
		tenantId,
		kind,
		value,
		verifiedAt: Date.now(),
		verificationMethod,
	});
	return true;
}

/** Assign identity once and register the verified names for a platform client. */
export async function ensureTenantAliases(
	ctx: Pick<MutationCtx, "db">,
	tenantId: string,
	siteUrl: string,
	verificationMethod: VerificationMethod,
) {
	let aliasesAdded = 0;
	for (const alias of aliasesForSiteUrl(siteUrl)) {
		if (
			await ensureAlias(
				ctx,
				tenantId,
				alias.kind,
				alias.value,
				verificationMethod,
			)
		) {
			aliasesAdded += 1;
		}
	}
	return aliasesAdded;
}

export async function ensureTenantIdentity(
	ctx: Pick<MutationCtx, "db">,
	client: Doc<"platformClients">,
	verificationMethod: VerificationMethod,
) {
	const tenantId = client.tenantId ?? `tenant_${crypto.randomUUID()}`;
	if (!client.tenantId) await ctx.db.patch(client._id, { tenantId });
	const aliasesAdded = await ensureTenantAliases(
		ctx,
		tenantId,
		client.siteUrl,
		verificationMethod,
	);
	return { tenantId, aliasesAdded, identityAdded: !client.tenantId };
}
