import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import { mutation, query } from "./_generated/server";
import {
	requireDocumentSiteAdmin,
	requireSiteAdmin,
	requireWebhookCallerOrAuth,
} from "./authHelpers";
import { hasValidGalleryAccessGrant } from "./galleryAccess";
import {
	DEFAULT_LIST_LIMIT,
	PORTAL_CAPABILITIES_PER_DOCUMENT_LIMIT,
} from "./helpers/limits";
import {
	quoteAcceptanceIsOpen,
	quoteValidUntilExclusiveUtcMs,
} from "./helpers/quoteValidity";

/**
 * Shape of the `portalTokens` row. Exported for use by the single-flight
 * action mutations below.
 */
type PortalTokenDoc = Doc<"portalTokens">;

type PortalDocumentDoc =
	| Doc<"invoices">
	| Doc<"quotes">
	| Doc<"contracts">
	| Doc<"galleries">;

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

function normalizePortalDocumentId<T extends PortalTokenType>(
	ctx: QueryCtx | MutationCtx,
	doc: PortalTokenDoc & { type: T },
): PortalDocumentIdFor<T> | null {
	const table =
		doc.type === "invoice"
			? "invoices"
			: doc.type === "quote"
				? "quotes"
				: doc.type === "contract"
					? "contracts"
					: "galleries";
	return ctx.db.normalizeId(table, doc.documentId) as PortalDocumentIdFor<T> | null;
}

async function loadPortalDocument(ctx: QueryCtx | MutationCtx, doc: PortalTokenDoc) {
	if (doc.type === "invoice") {
		const documentId = normalizePortalDocumentId(ctx, doc);
		return documentId ? await ctx.db.get(documentId) : null;
	}
	if (doc.type === "quote") {
		const documentId = normalizePortalDocumentId(ctx, doc);
		return documentId ? await ctx.db.get(documentId) : null;
	}
	if (doc.type === "contract") {
		const documentId = normalizePortalDocumentId(ctx, doc);
		return documentId ? await ctx.db.get(documentId) : null;
	}
	const documentId = normalizePortalDocumentId(ctx, doc);
	return documentId ? await ctx.db.get(documentId) : null;
}

function publicDocumentToken(tokenDoc: PortalTokenDoc) {
	return {
		type: tokenDoc.type,
		siteUrl: tokenDoc.siteUrl,
		used: tokenDoc.used,
	};
}

function projectInvoice(invoice: Doc<"invoices">) {
	return {
		_creationTime: invoice._creationTime,
		invoiceNumber: invoice.invoiceNumber,
		status: invoice.status,
		items: invoice.items,
		...(invoice.taxPercent !== undefined ? { taxPercent: invoice.taxPercent } : {}),
		...(invoice.notes !== undefined ? { notes: invoice.notes } : {}),
		...(invoice.dueDate !== undefined ? { dueDate: invoice.dueDate } : {}),
	};
}

function projectQuote(quote: Doc<"quotes">, now: number) {
	const status =
		quote.status === "sent" && !quoteAcceptanceIsOpen(quote.validUntil, now)
			? ("expired" as const)
			: quote.status;
	return {
		_creationTime: quote._creationTime,
		quoteNumber: quote.quoteNumber,
		status,
		packages: quote.packages,
		...(quote.validUntil !== undefined ? { validUntil: quote.validUntil } : {}),
		...(quote.notes !== undefined ? { notes: quote.notes } : {}),
	};
}

function projectContract(contract: Doc<"contracts">) {
	return {
		_creationTime: contract._creationTime,
		title: contract.title,
		status: contract.status,
		body: contract.body,
		...(contract.eventDate !== undefined ? { eventDate: contract.eventDate } : {}),
		...(contract.eventLocation !== undefined
			? { eventLocation: contract.eventLocation }
			: {}),
		...(contract.totalPrice !== undefined ? { totalPrice: contract.totalPrice } : {}),
		...(contract.depositAmount !== undefined
			? { depositAmount: contract.depositAmount }
			: {}),
		...(contract.signedAt !== undefined ? { signedAt: contract.signedAt } : {}),
	};
}

function quoteBoundPortalExpiry(
	quote: Doc<"quotes">,
	requestedExpiry: number | undefined,
) {
	if (quote.validUntil === undefined) return requestedExpiry;
	const quoteExpiry = quoteValidUntilExclusiveUtcMs(quote.validUntil);
	if (quoteExpiry === null) throw new Error("Quote validity date is invalid");
	return requestedExpiry === undefined ? quoteExpiry : Math.min(requestedExpiry, quoteExpiry);
}

function requireFutureExpiry(expiresAt: number | undefined, now: number) {
	if (
		expiresAt !== undefined &&
		(!Number.isSafeInteger(expiresAt) || expiresAt <= now)
	) {
		throw new Error("Portal expiration is invalid");
	}
}

function requireQuoteResponseWindow(quote: Doc<"quotes">, now: number) {
	if (quote.validUntil === undefined) return;
	const closesAt = quoteValidUntilExclusiveUtcMs(quote.validUntil);
	if (closesAt === null) throw new Error("Quote validity date is invalid");
	if (now >= closesAt) throw new Error("Quote has expired");
}

type NormalizedContractSignature = {
	signerName: string;
	signerEmail?: string;
	signatureData?: string;
};

const MAX_SIGNER_NAME_BYTES = 200;
const MAX_SIGNER_EMAIL_BYTES = 254;
const MAX_SIGNATURE_DATA_BYTES = 256 * 1024;

function utf8ByteLength(value: string) {
	return new TextEncoder().encode(value).byteLength;
}

function requireBoundedPortalText(
	value: string,
	label: string,
	maxBytes: number,
) {
	if (utf8ByteLength(value) > maxBytes) {
		throw new Error(`${label} is too long`);
	}
}

function normalizeContractSignature({
	signerName,
	signerEmail,
	signatureData,
}: NormalizedContractSignature): NormalizedContractSignature {
	const normalizedName = signerName.trim();
	if (!normalizedName) throw new Error("Signer name is required");
	if (/\p{Cc}/u.test(normalizedName)) {
		throw new Error("Signer name contains invalid characters");
	}
	requireBoundedPortalText(
		normalizedName,
		"Signer name",
		MAX_SIGNER_NAME_BYTES,
	);
	const normalizedEmail = signerEmail?.trim().toLowerCase() || undefined;
	const normalizedSignature = signatureData?.trim() || undefined;
	if (normalizedEmail !== undefined) {
		if (
			/\s|\p{Cc}/u.test(normalizedEmail) ||
			!/^[^@]+@[^@]+$/.test(normalizedEmail)
		) {
			throw new Error("Signer email is invalid");
		}
		requireBoundedPortalText(
			normalizedEmail,
			"Signer email",
			MAX_SIGNER_EMAIL_BYTES,
		);
	}
	if (normalizedSignature !== undefined) {
		if (/\u0000/.test(normalizedSignature)) {
			throw new Error("Signature data contains invalid characters");
		}
		// Signature data is an opaque UTF-8 evidence string. The public client
		// currently submits a typed name only; this bounded field preserves the
		// existing API for a future canvas/data-URL signature without accepting an
		// unbounded request or database row.
		requireBoundedPortalText(
			normalizedSignature,
			"Signature data",
			MAX_SIGNATURE_DATA_BYTES,
		);
	}
	return {
		signerName: normalizedName,
		...(normalizedEmail !== undefined ? { signerEmail: normalizedEmail } : {}),
		...(normalizedSignature !== undefined ? { signatureData: normalizedSignature } : {}),
	};
}

function contractSignatureMatches(
	contract: Doc<"contracts">,
	input: NormalizedContractSignature,
) {
	return (
		contract.signedByName?.trim() === input.signerName &&
		(contract.signedByEmail?.trim().toLowerCase() || undefined) === input.signerEmail &&
		(contract.signatureData?.trim() || undefined) === input.signatureData
	);
}

/**
 * Validate + load a portal token inside a mutation. The token is the caller's
 * authorization: any caller who knows the token is trusted to act on the
 * associated document (and only that document). Throws on every failure mode
 * so callers cannot silently act on invalid tokens.
 *
 * Checks, in order:
 *   - token exists
 *   - not administratively revoked
 *   - not expired
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
	if (tokenDoc.revokedAt !== undefined) throw new Error("Invalid token");
	if (tokenDoc.expiresAt !== undefined && Date.now() >= tokenDoc.expiresAt) {
		throw new Error("Token expired");
	}
	if (tokenDoc.type !== expectedType) {
		throw new Error(`Token is not for a ${expectedType}`);
	}
	const document = await loadPortalDocument(ctx, tokenDoc);
	if (
		!document ||
		document.siteUrl !== tokenDoc.siteUrl ||
		document.clientId !== tokenDoc.clientId
	) {
		throw new Error("Portal token does not match its document client");
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
		await requireSiteAdmin(ctx, args.siteUrl);
		const client = await ctx.db.get(args.clientId);
		if (!client || client.siteUrl !== args.siteUrl) {
			throw new Error("Client not found");
		}
		let document: Doc<"invoices"> | Doc<"quotes"> | Doc<"contracts"> | Doc<"galleries"> | null =
			null;
		if (args.type === "invoice") {
			document = await ctx.db.get(args.documentId as Id<"invoices">);
		} else if (args.type === "quote") {
			document = await ctx.db.get(args.documentId as Id<"quotes">);
		} else if (args.type === "contract") {
			document = await ctx.db.get(args.documentId as Id<"contracts">);
		} else {
			document = await ctx.db.get(args.documentId as Id<"galleries">);
		}
		if (!document || document.siteUrl !== args.siteUrl || document.clientId !== args.clientId) {
			throw new Error("Document not found");
		}
		const now = Date.now();
		const expiresAt =
			args.type === "quote"
				? quoteBoundPortalExpiry(document as Doc<"quotes">, args.expiresAt)
				: args.expiresAt;
		requireFutureExpiry(expiresAt, now);
		if (args.type !== "gallery") {
			// Accepted document-email replacements must be able to revoke the complete
			// raw documentId range atomically. This indexed read and the insert share a
			// transaction, so concurrent document creators converge through Convex OCC
			// retries. Gallery links do not participate in document-email rotation.
			const existingCapabilities = await ctx.db
				.query("portalTokens")
				.withIndex("by_documentId", (q) => q.eq("documentId", args.documentId))
				.take(PORTAL_CAPABILITIES_PER_DOCUMENT_LIMIT);
			if (existingCapabilities.length >= PORTAL_CAPABILITIES_PER_DOCUMENT_LIMIT) {
				throw new Error("Portal capability limit reached");
			}
		}
		const token = crypto.randomUUID();
		await ctx.db.insert("portalTokens", {
			token,
			siteUrl: args.siteUrl,
			type: args.type,
			documentId: args.documentId,
			clientId: args.clientId,
			expiresAt,
			used: false,
		});
		return token;
	},
});

type LoadedPortalRead = {
	tokenDoc: PortalTokenDoc;
	document: PortalDocumentDoc;
	client: Doc<"photographyClients">;
	now: number;
	tokenExpired: boolean;
};

type InvalidPortalRead = {
	kind: "invalid";
	tokenDoc: PortalTokenDoc;
	tokenExpired: boolean;
};

type PortalReadLoad =
	| { kind: "result"; result: null | { expired: true; reason: "expired" | "used" } }
	| InvalidPortalRead
	| { kind: "loaded"; value: LoadedPortalRead };

async function loadPortalRead(ctx: QueryCtx, token: string): Promise<PortalReadLoad> {
	const tokenDoc = await ctx.db
		.query("portalTokens")
		.withIndex("by_token", (q) => q.eq("token", token))
		.unique();
	if (!tokenDoc || tokenDoc.revokedAt !== undefined) {
		return { kind: "result", result: null };
	}

	const now = Date.now();
	const tokenExpired = tokenDoc.expiresAt !== undefined && now >= tokenDoc.expiresAt;
	if (tokenDoc.type === "gallery") {
		if (tokenExpired) {
			return { kind: "result", result: { expired: true, reason: "expired" } };
		}
		if (tokenDoc.used) {
			return { kind: "result", result: { expired: true, reason: "used" } };
		}
	} else if (!tokenDoc.used && tokenExpired) {
		return { kind: "result", result: { expired: true, reason: "expired" } };
	}

	const [client, document] = await Promise.all([
		ctx.db.get(tokenDoc.clientId),
		loadPortalDocument(ctx, tokenDoc),
	]);
	if (
		!document ||
		document.siteUrl !== tokenDoc.siteUrl ||
		document.clientId !== tokenDoc.clientId ||
		!client ||
		client.siteUrl !== tokenDoc.siteUrl
	) {
		return { kind: "invalid", tokenDoc, tokenExpired };
	}
	return {
		kind: "loaded",
		value: { tokenDoc, document, client, now, tokenExpired },
	};
}

function documentCapabilityIsReadable({
	tokenDoc,
	document,
}: LoadedPortalRead) {
	if (tokenDoc.type === "invoice") return !tokenDoc.used;
	if (tokenDoc.type === "quote") {
		const quote = document as Doc<"quotes">;
		if (quote.status === "accepted") {
			return tokenDoc.used && tokenDoc.consumedAction === "quote_accepted";
		}
		if (quote.status === "declined") {
			return tokenDoc.used && tokenDoc.consumedAction === "quote_declined";
		}
		return !tokenDoc.used;
	}
	if (tokenDoc.type === "contract") {
		const contract = document as Doc<"contracts">;
		if (contract.status === "signed") {
			return tokenDoc.used && tokenDoc.consumedAction === "contract_signed";
		}
		return !tokenDoc.used;
	}
	return true;
}

async function projectGalleryPortalRead(
	ctx: QueryCtx,
	loaded: LoadedPortalRead,
	accessGrant: string | undefined,
) {
	if (loaded.tokenDoc.type !== "gallery") {
		throw new Error("Expected a gallery portal capability");
	}
	const gallery = loaded.document as Doc<"galleries">;
	const access = await hasValidGalleryAccessGrant(
		ctx,
		loaded.tokenDoc,
		gallery,
		accessGrant,
	);
	return {
		expired: false as const,
		token: loaded.tokenDoc,
		document: { ...gallery, passwordProtected: access.passwordProtected },
		client: { name: loaded.client.name, email: loaded.client.email },
		requiresPassword: access.passwordProtected && !access.valid,
	};
}

function projectPublicDocumentPortalRead(loaded: LoadedPortalRead) {
	if (!documentCapabilityIsReadable(loaded)) return null;
	if (loaded.tokenExpired) {
		return { expired: true as const, reason: "expired" as const };
	}

	const { tokenDoc, document } = loaded;
	const token = publicDocumentToken(tokenDoc);
	const client = { name: loaded.client.name };
	if (tokenDoc.type === "invoice") {
		return {
			expired: false as const,
			token,
			document: projectInvoice(document as Doc<"invoices">),
			client,
			requiresPassword: false as const,
		};
	}
	if (tokenDoc.type === "quote") {
		return {
			expired: false as const,
			token,
			document: projectQuote(document as Doc<"quotes">, loaded.now),
			client,
			requiresPassword: false as const,
		};
	}
	return {
		expired: false as const,
		token,
		document: projectContract(document as Doc<"contracts">),
		client,
		requiresPassword: false as const,
	};
}

function projectLegacyDocumentPortalRead(loaded: LoadedPortalRead) {
	if (loaded.tokenExpired) {
		return { expired: true as const, reason: "expired" as const };
	}
	if (!documentCapabilityIsReadable(loaded)) {
		return loaded.tokenDoc.used
			? { expired: true as const, reason: "used" as const }
			: null;
	}
	const legacyClient: { name: string; email?: string } | null = {
		name: loaded.client.name,
		email: loaded.client.email,
	};
	return {
		expired: false as const,
		token: loaded.tokenDoc,
		document: loaded.document,
		client: legacyClient,
		requiresPassword: false as const,
	};
}

/**
 * Final public bearer-capability read for current hosts. Invoice, quote, and
 * contract results are explicit client-safe projections; gallery delivery
 * intentionally retains its existing raw result shape.
 */
export const getPublicByToken = query({
	args: { token: v.string(), accessGrant: v.optional(v.string()) },
	handler: async (ctx, { token, accessGrant }) => {
		const loaded = await loadPortalRead(ctx, token);
		if (loaded.kind === "result") return loaded.result;
		if (loaded.kind === "invalid") return null;
		if (loaded.value.tokenDoc.type === "gallery") {
			return await projectGalleryPortalRead(ctx, loaded.value, accessGrant);
		}
		return projectPublicDocumentPortalRead(loaded.value);
	},
});

/**
 * @deprecated Stage-A mixed-version compatibility query. Existing 3.x hosts
 * receive the exact legacy raw token/document/client shape while the backend is
 * widened and current hosts move to `getPublicByToken`. This temporary security
 * hold must not gain new callers. After every document host has migrated, Stage
 * C narrows only invoice/quote/contract branches and publishes CRM 4.0; gallery
 * delivery keeps this legacy shape.
 */
export const getByToken = query({
	args: { token: v.string(), accessGrant: v.optional(v.string()) },
	handler: async (ctx, { token, accessGrant }) => {
		const loaded = await loadPortalRead(ctx, token);
		if (loaded.kind === "result") return loaded.result;
		if (loaded.kind === "invalid") {
			if (loaded.tokenExpired) {
				return { expired: true as const, reason: "expired" as const };
			}
			return loaded.tokenDoc.used
				? { expired: true as const, reason: "used" as const }
				: null;
		}
		if (loaded.value.tokenDoc.type === "gallery") {
			return await projectGalleryPortalRead(ctx, loaded.value, accessGrant);
		}
		return projectLegacyDocumentPortalRead(loaded.value);
	},
});

/**
 * Resolve the raw invoice ID required for Stripe metadata only for the trusted
 * SvelteKit server. The final `getPublicByToken` bearer query deliberately omits
 * it; deprecated `getByToken` retains it only during the Stage-A compatibility
 * hold described above.
 */
export const getInvoiceCheckoutTarget = query({
	args: { token: v.string(), webhookSecret: v.string() },
	handler: async (ctx, { token, webhookSecret }) => {
		await requireWebhookCallerOrAuth(ctx, webhookSecret, { allowAuth: false });
		const tokenDoc = await ctx.db
			.query("portalTokens")
			.withIndex("by_token", (q) => q.eq("token", token))
			.unique();
		if (
			!tokenDoc ||
			tokenDoc.type !== "invoice" ||
			tokenDoc.revokedAt !== undefined ||
			tokenDoc.used ||
			(tokenDoc.expiresAt !== undefined && Date.now() >= tokenDoc.expiresAt)
		) {
			return null;
		}
		const invoiceToken = tokenDoc as PortalTokenDoc & { type: "invoice" };
		const invoiceId = normalizePortalDocumentId(ctx, invoiceToken);
		if (!invoiceId) return null;
		const [invoice, client] = await Promise.all([
			ctx.db.get(invoiceId),
			ctx.db.get(tokenDoc.clientId),
		]);
		if (
			!invoice ||
			invoice.siteUrl !== tokenDoc.siteUrl ||
			invoice.clientId !== tokenDoc.clientId ||
			!client ||
			client.siteUrl !== tokenDoc.siteUrl
		) {
			return null;
		}
		return {
			invoiceId,
			siteUrl: invoice.siteUrl,
			status: invoice.status,
			items: invoice.items,
			...(invoice.taxPercent !== undefined ? { taxPercent: invoice.taxPercent } : {}),
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
		if (tokenDoc.used) {
			if (
				tokenDoc.consumedAction === "quote_accepted" &&
				quote.status === "accepted"
			) {
				return;
			}
			throw new Error("Token already used");
		}
		// Same-token idempotency is proven by the marker branch above. An
		// already-terminal quote reached through any other token stays immutable.
		if (quote.status !== "sent") {
			throw new Error("Quote is no longer awaiting a response");
		}
		requireQuoteResponseWindow(quote, Date.now());
		{
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
		await ctx.db.patch(tokenDoc._id, {
			used: true,
			consumedAction: "quote_accepted",
		});
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
		if (tokenDoc.used) {
			if (
				tokenDoc.consumedAction === "quote_declined" &&
				quote.status === "declined"
			) {
				return;
			}
			throw new Error("Token already used");
		}
		if (quote.status !== "sent") {
			throw new Error("Quote is no longer awaiting a response");
		}
		requireQuoteResponseWindow(quote, Date.now());
		{
			await ctx.db.patch(quoteId, { status: "declined" });
			await ctx.runMutation(internal.activityLog.logActivity, {
				siteUrl: quote.siteUrl,
				clientId: quote.clientId,
				action: "quote_declined",
				description: `quote ${quote.quoteNumber} declined`,
				metadata: JSON.stringify({ docType: "quote", docId: quoteId }),
			});
		}
		await ctx.db.patch(tokenDoc._id, {
			used: true,
			consumedAction: "quote_declined",
		});
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
		const normalized = normalizeContractSignature({
			signerName,
			...(signerEmail !== undefined ? { signerEmail } : {}),
			...(signatureData !== undefined ? { signatureData } : {}),
		});
		const tokenDoc = await loadPortalTokenForAction(ctx, token, "contract");
		const contractId = tokenDoc.documentId;
		const contract = await ctx.db.get(contractId);
		if (!contract || contract.siteUrl !== tokenDoc.siteUrl) {
			throw new Error("Contract not found");
		}
		if (tokenDoc.used) {
			if (
				tokenDoc.consumedAction === "contract_signed" &&
				contract.status === "signed" &&
				contractSignatureMatches(contract, normalized)
			) {
				return;
			}
			if (
				tokenDoc.consumedAction === "contract_signed" &&
				contract.status === "signed"
			) {
				throw new Error("Signature replay does not match the recorded signature");
			}
			throw new Error("Token already used");
		}
		if (contract.status === "signed") {
			throw new Error("Contract is no longer awaiting a signature");
		}
		if (contract.status !== "sent") {
			throw new Error("Contract is no longer awaiting a signature");
		}
		{
			await ctx.db.patch(contractId, {
				status: "signed",
				signedAt: Date.now(),
				signedByName: normalized.signerName,
				signedByEmail: normalized.signerEmail,
				signatureData: normalized.signatureData,
			});
			await ctx.runMutation(internal.activityLog.logActivity, {
				siteUrl: contract.siteUrl,
				clientId: contract.clientId,
				action: "contract_signed",
				description: `contract "${contract.title}" signed by ${normalized.signerName}`,
				metadata: JSON.stringify({ docType: "contract", docId: contractId }),
			});
		}
		await ctx.db.patch(tokenDoc._id, {
			used: true,
			consumedAction: "contract_signed",
		});
	},
});

/**
 * @deprecated Use acceptQuote/declineQuote/signContract instead — those are
 * atomic. This remains only to avoid breaking external callers that still
 * import it; it is now authenticated to block the original abuse. It cannot
 * mint a terminal receipt because it deliberately writes no consumption marker.
 */
export const markUsed = mutation({
	args: { token: v.string() },
	handler: async (ctx, { token }) => {
		const tokenDoc = await ctx.db
			.query("portalTokens")
			.withIndex("by_token", (q) => q.eq("token", token))
			.unique();
		if (!tokenDoc) throw new Error("Token not found");
		await requireDocumentSiteAdmin(ctx, "portalTokens", tokenDoc._id);
		await ctx.db.patch(tokenDoc._id, { used: true });
	},
});

export const listTokens = query({
	args: { siteUrl: v.string() },
	handler: async (ctx, { siteUrl }) => {
		await requireSiteAdmin(ctx, siteUrl);
		return await ctx.db
			.query("portalTokens")
			.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
			.order("desc")
			.take(DEFAULT_LIST_LIMIT);
	},
});
