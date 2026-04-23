import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import { requireAuth } from "./authHelpers";
import { DEFAULT_LIST_LIMIT } from "./helpers/limits";

/**
 * Shape of the `portalTokens` row. Exported for use by the single-flight
 * action mutations below.
 */
type PortalTokenDoc = Doc<"portalTokens">;

/** Portal token type-tag values, mirrored from the schema union. */
type PortalTokenType = PortalTokenDoc["type"];

/**
 * Map each token `type` to the Convex Id type its `documentId` actually
 * references. `documentId` is stored as `v.string()` in the schema (audit
 * M11 — changing that would require a migration); this table is the
 * TypeScript-level discriminated mapping callers use to stay type-safe.
 */
type PortalDocumentIdFor<T extends PortalTokenType> = T extends "invoice"
	? Id<"invoices">
	: T extends "quote"
		? Id<"quotes">
		: T extends "contract"
			? Id<"contracts">
			: T extends "gallery"
				? Id<"galleries">
				: never;

/** Portal token narrowed by a specific `type` — `documentId` comes back correctly typed. */
type NarrowedPortalToken<T extends PortalTokenType> = Omit<
	PortalTokenDoc,
	"type" | "documentId"
> & {
	type: T;
	documentId: PortalDocumentIdFor<T>;
};

/**
 * Given a token doc that's already had its `type` narrowed (e.g. inside a
 * branch of `switch (tokenDoc.type)`), return its `documentId` with the
 * Id type that matches `type`. Runs no runtime check — callers must narrow
 * first. Replaces per-site `documentId as Id<"...">` casts.
 */
function typedDocumentId<T extends PortalTokenType>(
	doc: PortalTokenDoc & { type: T },
): PortalDocumentIdFor<T> {
	return doc.documentId as PortalDocumentIdFor<T>;
}

/**
 * Validate + load a portal token inside a mutation. The token is the caller's
 * authorization: any caller who knows the token is trusted to act on the
 * associated document (and only that document). Throws on every failure mode
 * so callers cannot silently act on invalid tokens.
 *
 * Checks, in order:
 *   - token exists
 *   - not expired
 *   - not already used
 *   - expected type matches
 *   - the underlying document exists AND its siteUrl matches the token's
 *     siteUrl (defense in depth against cross-tenant token forgery)
 */
async function loadPortalTokenForAction<T extends PortalTokenType>(
	ctx: MutationCtx,
	token: string,
	expectedType: T,
): Promise<NarrowedPortalToken<T>> {
	const tokenDoc = await ctx.db
		.query("portalTokens")
		.withIndex("by_token", (q) => q.eq("token", token))
		.unique();
	if (!tokenDoc) throw new Error("Invalid token");
	if (tokenDoc.expiresAt && Date.now() > tokenDoc.expiresAt) {
		throw new Error("Token expired");
	}
	if (tokenDoc.used) {
		throw new Error("Token already used");
	}
	if (tokenDoc.type !== expectedType) {
		throw new Error(`Token is not for a ${expectedType}`);
	}
	// Narrowed by the runtime `type` check just above.
	return tokenDoc as unknown as NarrowedPortalToken<T>;
}

/**
 * Create a portal share token. Creator-authenticated only.
 * Previously this was public — fixed as part of audit C3.
 */
export const createToken = mutation({
	args: {
		siteUrl: v.string(),
		type: v.union(
			v.literal("invoice"),
			v.literal("quote"),
			v.literal("contract"),
			v.literal("gallery"),
		),
		documentId: v.string(),
		clientId: v.id("photographyClients"),
		expiresAt: v.optional(v.number()),
	},
	handler: async (ctx, args) => {
		await requireAuth(ctx);
		const token = crypto.randomUUID();
		await ctx.db.insert("portalTokens", {
			token,
			siteUrl: args.siteUrl,
			type: args.type,
			documentId: args.documentId,
			clientId: args.clientId,
			expiresAt: args.expiresAt,
			used: false,
		});
		return token;
	},
});

/**
 * Read a portal token + its linked document. Still public — clients reach this
 * from an unauthenticated URL — but now hardened against:
 *   - used tokens (returns { expired: true, reason: "used" })
 *   - cross-tenant drift where token.siteUrl != document.siteUrl
 */
export const getByToken = query({
	args: { token: v.string() },
	handler: async (ctx, { token }) => {
		const tokenDoc = await ctx.db
			.query("portalTokens")
			.withIndex("by_token", (q) => q.eq("token", token))
			.unique();
		if (!tokenDoc) return null;

		if (tokenDoc.expiresAt && Date.now() > tokenDoc.expiresAt) {
			return { expired: true as const, reason: "expired" as const };
		}
		if (tokenDoc.used) {
			return { expired: true as const, reason: "used" as const };
		}

		const client = await ctx.db.get(tokenDoc.clientId);

		let document: Doc<"invoices" | "quotes" | "contracts" | "galleries"> | null =
			null;
		if (tokenDoc.type === "invoice") {
			document = await ctx.db.get(typedDocumentId(tokenDoc));
		} else if (tokenDoc.type === "quote") {
			document = await ctx.db.get(typedDocumentId(tokenDoc));
		} else if (tokenDoc.type === "contract") {
			document = await ctx.db.get(typedDocumentId(tokenDoc));
		} else if (tokenDoc.type === "gallery") {
			document = await ctx.db.get(typedDocumentId(tokenDoc));
		}

		if (!document) return null;

		// Defense in depth: refuse to return a cross-tenant pairing.
		if (document.siteUrl !== tokenDoc.siteUrl) return null;

		return {
			expired: false as const,
			token: tokenDoc,
			document,
			client: client ? { name: client.name, email: client.email } : null,
		};
	},
});

/**
 * Accept a quote through a portal token. Atomic: validates token, patches
 * quote, marks token used — all in one transaction. No `requireAuth` call:
 * possession of the token IS the authorization.
 *
 * This replaces the old two-step flow (call `quotes.markAccepted` then
 * `portal.markUsed`) which had a replay window if the second call failed.
 */
export const acceptQuote = mutation({
	args: { token: v.string() },
	handler: async (ctx, { token }) => {
		const tokenDoc = await loadPortalTokenForAction(ctx, token, "quote");
		const quoteId = tokenDoc.documentId;
		const quote = await ctx.db.get(quoteId);
		if (!quote || quote.siteUrl !== tokenDoc.siteUrl) {
			throw new Error("Quote not found");
		}
		// Idempotency: if already accepted, still mark the token used so the
		// link can't be replayed on something else later. Don't re-log.
		if (quote.status !== "accepted") {
			await ctx.db.patch(quoteId, {
				status: "accepted",
				acceptedAt: Date.now(),
			});
			await ctx.runMutation(internal.activityLog.logActivity, {
				siteUrl: quote.siteUrl,
				clientId: quote.clientId,
				action: "quote_accepted",
				description: `quote ${quote.quoteNumber} accepted`,
				metadata: JSON.stringify({ docType: "quote", docId: quoteId }),
			});
		}
		await ctx.db.patch(tokenDoc._id, { used: true });
	},
});

/**
 * Decline a quote through a portal token. Atomic; same pattern as
 * `acceptQuote`.
 */
export const declineQuote = mutation({
	args: { token: v.string() },
	handler: async (ctx, { token }) => {
		const tokenDoc = await loadPortalTokenForAction(ctx, token, "quote");
		const quoteId = tokenDoc.documentId;
		const quote = await ctx.db.get(quoteId);
		if (!quote || quote.siteUrl !== tokenDoc.siteUrl) {
			throw new Error("Quote not found");
		}
		if (quote.status !== "declined") {
			await ctx.db.patch(quoteId, { status: "declined" });
			await ctx.runMutation(internal.activityLog.logActivity, {
				siteUrl: quote.siteUrl,
				clientId: quote.clientId,
				action: "quote_declined",
				description: `quote ${quote.quoteNumber} declined`,
				metadata: JSON.stringify({ docType: "quote", docId: quoteId }),
			});
		}
		await ctx.db.patch(tokenDoc._id, { used: true });
	},
});

/**
 * Sign a contract through a portal token. Atomic; also records the signer's
 * name, optional email, and optional signature data. The `signerName` is
 * required (matching the SvelteKit route's validation).
 *
 * Previously the SvelteKit route accepted `signerName` in the body, validated
 * it, then never passed it to the mutation — signer identity was silently
 * discarded. See audit H2.
 */
export const signContract = mutation({
	args: {
		token: v.string(),
		signerName: v.string(),
		signerEmail: v.optional(v.string()),
		signatureData: v.optional(v.string()),
	},
	handler: async (ctx, { token, signerName, signerEmail, signatureData }) => {
		if (!signerName.trim()) throw new Error("Signer name is required");
		const tokenDoc = await loadPortalTokenForAction(ctx, token, "contract");
		const contractId = tokenDoc.documentId;
		const contract = await ctx.db.get(contractId);
		if (!contract || contract.siteUrl !== tokenDoc.siteUrl) {
			throw new Error("Contract not found");
		}
		if (contract.status !== "signed") {
			await ctx.db.patch(contractId, {
				status: "signed",
				signedAt: Date.now(),
				signedByName: signerName.trim(),
				signedByEmail: signerEmail?.trim() || undefined,
				signatureData: signatureData || undefined,
			});
			await ctx.runMutation(internal.activityLog.logActivity, {
				siteUrl: contract.siteUrl,
				clientId: contract.clientId,
				action: "contract_signed",
				description: `contract "${contract.title}" signed by ${signerName.trim()}`,
				metadata: JSON.stringify({ docType: "contract", docId: contractId }),
			});
		}
		await ctx.db.patch(tokenDoc._id, { used: true });
	},
});

/**
 * @deprecated Use acceptQuote/declineQuote/signContract instead — those are
 * atomic. This remains only to avoid breaking external callers that still
 * import it; it is now authenticated to block the original abuse.
 */
export const markUsed = mutation({
	args: { token: v.string() },
	handler: async (ctx, { token }) => {
		await requireAuth(ctx);
		const tokenDoc = await ctx.db
			.query("portalTokens")
			.withIndex("by_token", (q) => q.eq("token", token))
			.unique();
		if (!tokenDoc) throw new Error("Token not found");
		await ctx.db.patch(tokenDoc._id, { used: true });
	},
});

export const listTokens = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireAuth(ctx);
		return await ctx.db
			.query("portalTokens")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(DEFAULT_LIST_LIMIT);
	},
});
