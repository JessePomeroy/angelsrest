import { makeFunctionReference } from "convex/server";
import { ConvexError, v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import {
	internalMutation,
	type MutationCtx,
	mutation,
	type QueryCtx,
	query,
} from "./_generated/server";
import { requireSiteAdmin } from "./authHelpers";
import {
	documentEmailDocumentValidator,
	documentEmailEnvelopeValidator,
	documentEmailResolutionValidator,
} from "./helpers/documentEmailAttemptValidators";
import { PORTAL_CAPABILITIES_PER_DOCUMENT_LIMIT } from "./helpers/limits";
import { quoteValidUntilExclusiveUtcMs } from "./helpers/quoteValidity";

export const DOCUMENT_EMAIL_CLAIM_LEASE_MS = 2 * 60 * 1000;
export const DOCUMENT_EMAIL_RECONCILIATION_WINDOW_MS = 23 * 60 * 60 * 1000;
export const DOCUMENT_EMAIL_NEGATIVE_RESOLUTION_DELAY_MS =
	24 * 60 * 60 * 1000 + 5 * 60 * 1000;
export const DOCUMENT_EMAIL_MAX_CLAIMS = 8;
export const DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT =
	PORTAL_CAPABILITIES_PER_DOCUMENT_LIMIT;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const MAX_ADDRESS_BYTES = 512;
const MAX_SUBJECT_BYTES = 998;
const MAX_TEXT_BYTES = 128 * 1024;
const MAX_HTML_BYTES = 256 * 1024;
const MAX_FAILURE_BYTES = 4096;
const MAX_RESOLUTION_NOTE_BYTES = 2048;

type PrepareRejectionReason =
	| "invalid_request"
	| "attempt_conflict"
	| "document_unavailable"
	| "document_not_sendable"
	| "portal_unavailable"
	| "client_unavailable"
	| "message_invalid"
	| "portal_token_conflict";

export const DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES = {
	notFound: "DOCUMENT_EMAIL_NOT_FOUND",
	documentMismatch: "DOCUMENT_EMAIL_DOCUMENT_MISMATCH",
	invalidResolution: "DOCUMENT_EMAIL_INVALID_RESOLUTION",
	terminal: "DOCUMENT_EMAIL_TERMINAL",
	resolutionConflict: "DOCUMENT_EMAIL_RESOLUTION_CONFLICT",
	notEligible: "DOCUMENT_EMAIL_NOT_ELIGIBLE",
	liveClaim: "DOCUMENT_EMAIL_LIVE_CLAIM",
	providerEvidenceRequired: "DOCUMENT_EMAIL_PROVIDER_EVIDENCE_REQUIRED",
	providerEvidenceConflict: "DOCUMENT_EMAIL_PROVIDER_EVIDENCE_CONFLICT",
} as const;

type DocumentEmailResolutionErrorCode =
	(typeof DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES)[keyof typeof DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES];

function resolutionError(code: DocumentEmailResolutionErrorCode, message: string): never {
	throw new ConvexError({ code, message });
}

type DocumentReference =
	| { type: "invoice"; id: Id<"invoices"> }
	| { type: "quote"; id: Id<"quotes"> }
	| { type: "contract"; id: Id<"contracts"> };

type Envelope = {
	from: string;
	to: string;
	replyTo?: string;
	subject: string;
	text: string;
	html: string;
};

type SendableDocument = Doc<"invoices"> | Doc<"quotes"> | Doc<"contracts">;
type DatabaseCtx = QueryCtx | MutationCtx;

const expireClaimReference = makeFunctionReference<
	"mutation",
	{
		attemptId: Id<"documentEmailAttempts">;
		claimId: string;
		claimExpiresAt: number;
	}
>("documentEmailAttempts:expireClaim");

function byteLength(value: string) {
	return new TextEncoder().encode(value).byteLength;
}

function requireUuid(value: string, label: string) {
	if (!UUID_PATTERN.test(value)) {
		throw new Error(`${label} must be a canonical UUID`);
	}
}

function requireBoundedText(
	value: string,
	label: string,
	maxBytes: number,
	{ allowEmpty = false }: { allowEmpty?: boolean } = {},
) {
	if ((!allowEmpty && value.length === 0) || byteLength(value) > maxBytes) {
		throw new Error(`${label} is invalid`);
	}
}

function validateAddress(value: string, label: string) {
	requireBoundedText(value, label, MAX_ADDRESS_BYTES);
	if (value !== value.trim() || /[\r\n]/.test(value)) {
		throw new Error(`${label} is invalid`);
	}
}

function canonicalPortalOrigin(siteUrl: string, value: string) {
	let parsed: URL;
	try {
		parsed = new URL(value);
	} catch {
		throw new Error("Portal origin is invalid");
	}
	if (
		(parsed.protocol !== "https:" && parsed.protocol !== "http:") ||
		parsed.username ||
		parsed.password ||
		parsed.origin !== value ||
		parsed.host !== siteUrl
	) {
		throw new Error("Portal origin does not match the tenant site");
	}
	return parsed.origin;
}

function portalUrlFor(origin: string, token: string) {
	return `${origin}/portal/${token}`;
}

function providerIdempotencyKey(document: DocumentReference, attemptId: string) {
	return `document-email-v1/${document.type}/${document.id}/${attemptId}`;
}

function documentKey(document: DocumentReference) {
	return `${document.type}:${document.id}`;
}

function providerTags(attemptId: string) {
	return [{ name: "document_attempt", value: attemptId }];
}

function prepareRejected(reason: PrepareRejectionReason) {
	return { outcome: "rejected" as const, reason };
}

function validateEnvelope(envelope: Envelope, portalUrl: string, clientEmail: string) {
	validateAddress(envelope.from, "Sender");
	validateAddress(envelope.to, "Recipient");
	if (envelope.replyTo !== undefined) {
		validateAddress(envelope.replyTo, "Reply-to address");
	}
	if (envelope.to.toLowerCase() !== clientEmail.trim().toLowerCase()) {
		throw new Error("Recipient does not match the document client");
	}
	requireBoundedText(envelope.subject, "Subject", MAX_SUBJECT_BYTES);
	if (/\r|\n/.test(envelope.subject)) {
		throw new Error("Subject is invalid");
	}
	requireBoundedText(envelope.text, "Plain-text body", MAX_TEXT_BYTES);
	requireBoundedText(envelope.html, "HTML body", MAX_HTML_BYTES);
	if (!envelope.text.includes(portalUrl) || !envelope.html.includes(portalUrl)) {
		throw new Error("Frozen message must contain its portal URL");
	}
}

async function loadDocument(
	ctx: DatabaseCtx,
	document: DocumentReference,
): Promise<SendableDocument | null> {
	if (document.type === "invoice") {
		return await ctx.db.get(document.id);
	}
	if (document.type === "quote") {
		return await ctx.db.get(document.id);
	}
	return await ctx.db.get(document.id);
}

function hasSendableDocumentStatus(
	reference: DocumentReference,
	document: SendableDocument,
) {
	return (
		reference.type === "invoice"
			? document.status === "draft" ||
				document.status === "sent" ||
				document.status === "overdue"
			: document.status === "draft" || document.status === "sent"
	);
}

function documentMatches(
	document: DocumentReference,
	left: Doc<"documentEmailAttempts">["document"],
) {
	return left.type === document.type && left.id === document.id;
}

function envelopeMatches(left: Envelope, right: Envelope) {
	return (
		left.from === right.from &&
		left.to === right.to &&
		left.replyTo === right.replyTo &&
		left.subject === right.subject &&
		left.text === right.text &&
		left.html === right.html
	);
}

async function getAttempt(ctx: DatabaseCtx, siteUrl: string, attemptId: string) {
	return await ctx.db
		.query("documentEmailAttempts")
		.withIndex("by_siteUrl_and_attemptId", (q) =>
			q.eq("siteUrl", siteUrl).eq("attemptId", attemptId),
		)
		.unique();
}

async function getOpenDocumentAttempt(
	ctx: DatabaseCtx,
	siteUrl: string,
	document: DocumentReference,
) {
	return await ctx.db
		.query("documentEmailAttempts")
		.withIndex("by_siteUrl_and_documentKey_and_open", (q) =>
			q.eq("siteUrl", siteUrl).eq("documentKey", documentKey(document)).eq("open", true),
		)
		.unique();
}

async function loadPortalCapabilityRange(ctx: MutationCtx, documentId: string) {
	// The sentinel row proves the complete raw index range fits the transaction's
	// rotation budget. Reading the raw range also prevents forged/cross-type rows
	// from hiding matching capabilities beyond a filtered prefix.
	return await ctx.db
		.query("portalTokens")
		.withIndex("by_documentId", (q) => q.eq("documentId", documentId))
		.take(DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT + 1);
}

async function retirePriorPortalCapabilities(
	ctx: MutationCtx,
	attempt: Doc<"documentEmailAttempts">,
	now: number,
) {
	// The raw documentId index may include forged/cross-type rows, so bound the
	// entire range rather than taking N matching rows and risking a silent tail.
	// Exceeding the cap aborts the acceptance transaction before any capability,
	// document lifecycle, or delivery-log change can commit.
	const candidates = await loadPortalCapabilityRange(ctx, attempt.document.id);
	if (candidates.length > DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT) {
		throw new Error("Portal capability count exceeds the document email rotation limit");
	}
	for (const portalToken of candidates) {
		if (
			portalToken._id === attempt.portalTokenId ||
			portalToken.siteUrl !== attempt.siteUrl ||
			portalToken.type !== attempt.document.type ||
			portalToken.documentId !== attempt.document.id ||
			portalToken.clientId !== attempt.clientId ||
			portalToken.revokedAt !== undefined
		) {
			continue;
		}
		await ctx.db.patch(portalToken._id, { used: true, revokedAt: now });
	}
}

function hasLiveClaim(attempt: Doc<"documentEmailAttempts">, now: number) {
	return (
		attempt.status === "claimed" &&
		(attempt.claimExpiresAt === undefined || attempt.claimExpiresAt > now)
	);
}

function portalHasExpired(attempt: Doc<"documentEmailAttempts">, now: number) {
	return attempt.portalExpiresAt !== undefined && now >= attempt.portalExpiresAt;
}

function resolveNotAcceptedAt(attempt: Doc<"documentEmailAttempts">) {
	return attempt.status === "prepared" && attempt.claimCount === 0
		? attempt.createdAt
		: (attempt.claimedAt ?? attempt.createdAt) +
				DOCUMENT_EMAIL_NEGATIVE_RESOLUTION_DELAY_MS;
}

function recoveryProjection(attempt: Doc<"documentEmailAttempts">, now: number) {
	const retryUntil = attempt.createdAt + DOCUMENT_EMAIL_RECONCILIATION_WINDOW_MS;
	const negativeAt = resolveNotAcceptedAt(attempt);
	const liveClaim = hasLiveClaim(attempt, now);
	const portalExpired = portalHasExpired(attempt, now);
	const hasProviderMessageId = attempt.providerMessageId !== undefined;
	const retryableStatus = attempt.status === "prepared" || attempt.status === "uncertain";
	return {
		protocolVersion: 1 as const,
		attemptId: attempt.attemptId,
		document: attempt.document,
		status: attempt.status,
		recipient: attempt.envelope.to,
		subject: attempt.envelope.subject,
		...(attempt.providerMessageId !== undefined
			? { providerMessageId: attempt.providerMessageId }
			: {}),
		...(attempt.failure !== undefined ? { failure: attempt.failure } : {}),
		claimCount: attempt.claimCount,
		createdAt: attempt.createdAt,
		updatedAt: attempt.updatedAt,
		retryUntil,
		resolveNotAcceptedAt: negativeAt,
		portalExpired,
		canRetry:
			attempt.open &&
			!attempt.providerRetryBlocked &&
			retryableStatus &&
			!liveClaim &&
			!portalExpired &&
			!hasProviderMessageId &&
			now < retryUntil &&
			attempt.claimCount < DOCUMENT_EMAIL_MAX_CLAIMS,
		canFinalizeAcceptance: attempt.open && hasProviderMessageId,
		canRecordAcceptance:
			attempt.open &&
			!hasProviderMessageId &&
			attempt.claimCount > 0 &&
			!liveClaim,
		canResolveNotAccepted:
			attempt.open &&
			!hasProviderMessageId &&
			!liveClaim &&
			now >= negativeAt,
	};
}

type ClaimTargetCheck =
	| { valid: true }
	| { valid: false; portalExpired: boolean; failure: string };

async function checkProviderClaimCapacity(
	ctx: MutationCtx,
	attempt: Doc<"documentEmailAttempts">,
): Promise<ClaimTargetCheck> {
	const capabilities = await loadPortalCapabilityRange(ctx, attempt.document.id);
	return capabilities.length <= DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT
		? { valid: true }
		: {
				valid: false,
				portalExpired: false,
				failure: "Document portal capability limit was exceeded before provider delivery",
			};
}

async function checkClaimTarget(
	ctx: MutationCtx,
	attempt: Doc<"documentEmailAttempts">,
	now: number,
): Promise<ClaimTargetCheck> {
	const [document, client, portalToken] = await Promise.all([
		loadDocument(ctx, attempt.document),
		ctx.db.get(attempt.clientId),
		ctx.db.get(attempt.portalTokenId),
	]);
	if (
		!document ||
		document.siteUrl !== attempt.siteUrl ||
		document.clientId !== attempt.clientId ||
		!client ||
		client.siteUrl !== attempt.siteUrl ||
		!client.email ||
		client.email.trim().toLowerCase() !== attempt.envelope.to.trim().toLowerCase()
	) {
		return {
			valid: false,
			portalExpired: false,
			failure: "Document email target no longer matches its tenant client",
		};
	}
	if (!hasSendableDocumentStatus(attempt.document, document)) {
		return {
			valid: false,
			portalExpired: false,
			failure: "Document is no longer in a sendable state",
		};
	}
	if (attempt.document.type === "quote") {
		const quote = document as Doc<"quotes">;
		const currentQuoteExpiry =
			quote.validUntil === undefined
				? undefined
				: quoteValidUntilExclusiveUtcMs(quote.validUntil);
		if (
			currentQuoteExpiry === null ||
			(currentQuoteExpiry !== undefined && now >= currentQuoteExpiry)
		) {
			return {
				valid: false,
				portalExpired: currentQuoteExpiry !== null,
				failure:
					currentQuoteExpiry === null
						? "Quote validity is no longer a valid date-only boundary"
						: "Quote validity expired before provider delivery",
			};
		}
	}
	if (
		!portalToken ||
		portalToken.siteUrl !== attempt.siteUrl ||
		portalToken.type !== attempt.document.type ||
		portalToken.documentId !== attempt.document.id ||
		portalToken.clientId !== attempt.clientId ||
		portalToken.expiresAt !== attempt.portalExpiresAt
	) {
		return {
			valid: false,
			portalExpired: false,
			failure: "Document email portal target no longer matches its frozen attempt",
		};
	}
	if (
		portalToken.revokedAt !== undefined ||
		portalToken.used ||
		(portalToken.expiresAt !== undefined && now >= portalToken.expiresAt)
	) {
		return {
			valid: false,
			portalExpired: true,
			failure:
				portalToken.revokedAt !== undefined
					? "Document email portal link was revoked before provider delivery"
					: portalToken.used
						? "Document email portal link was already used before provider delivery"
						: "Document email portal link expired before provider delivery",
		};
	}
	return { valid: true };
}

async function refuseProviderClaim(
	ctx: MutationCtx,
	attempt: Doc<"documentEmailAttempts">,
	now: number,
	check: Exclude<ClaimTargetCheck, { valid: true }>,
) {
	const definitelyUnsent = attempt.status === "prepared" && attempt.claimCount === 0;
	if (definitelyUnsent) {
		await revokeAttemptPortalCapability(ctx, attempt);
	}
	await ctx.db.patch(attempt._id, definitelyUnsent
		? {
				status: "resolved_not_sent",
				open: false,
				providerRetryBlocked: true,
				failure: check.failure,
				updatedAt: now,
				terminalAt: now,
			}
		: {
				status: "uncertain",
				open: true,
				providerRetryBlocked: true,
				failure: check.failure,
				updatedAt: now,
			});
	const refused = await ctx.db.get(attempt._id);
	if (!refused) throw new Error("Document email attempt was not stored");
	return {
		outcome: check.portalExpired ? ("expired" as const) : definitelyUnsent
			? ("released" as const)
			: ("uncertain" as const),
		attempt: refused,
	};
}

function requireAttempt(attempt: Doc<"documentEmailAttempts"> | null) {
	if (!attempt) throw new Error("Document email attempt not found");
	return attempt;
}

function validateFailure(value: string) {
	requireBoundedText(value, "Delivery failure", MAX_FAILURE_BYTES);
}

async function completeDocumentLifecycle(
	ctx: MutationCtx,
	attempt: Doc<"documentEmailAttempts">,
	now: number,
) {
	const document = await loadDocument(ctx, attempt.document);
	if (!document || document.siteUrl !== attempt.siteUrl || document.clientId !== attempt.clientId) {
		throw new Error("Document email target no longer matches its tenant client");
	}

	const updates: { status?: "sent"; sentAt?: number } = {};
	if (document.status === "draft") updates.status = "sent";
	if (document.sentAt === undefined) updates.sentAt = now;
	if (updates.status !== undefined || updates.sentAt !== undefined) {
		if (attempt.document.type === "invoice") {
			await ctx.db.patch(attempt.document.id, updates);
		} else if (attempt.document.type === "quote") {
			await ctx.db.patch(attempt.document.id, updates);
		} else {
			await ctx.db.patch(attempt.document.id, updates);
		}
	}

	if (attempt.document.type === "invoice") {
		const invoice = document as Doc<"invoices">;
		return `invoice ${invoice.invoiceNumber} sent`;
	}
	if (attempt.document.type === "quote") {
		const quote = document as Doc<"quotes">;
		return `quote ${quote.quoteNumber} sent`;
	}
	const contract = document as Doc<"contracts">;
	return `contract "${contract.title}" sent`;
}

type ResolutionLifecycle =
	| "advanced"
	| "preserved"
	| "target_missing"
	| "target_mismatch";

async function applyAcceptedResolutionLifecycle(
	ctx: MutationCtx,
	attempt: Doc<"documentEmailAttempts">,
	now: number,
): Promise<{ lifecycle: ResolutionLifecycle; keepPortalActionable: boolean }> {
	const document = await loadDocument(ctx, attempt.document);
	if (!document) {
		return { lifecycle: "target_missing", keepPortalActionable: false };
	}
	if (document.siteUrl !== attempt.siteUrl || document.clientId !== attempt.clientId) {
		return { lifecycle: "target_mismatch", keepPortalActionable: false };
	}

	const updates: { status?: "sent"; sentAt?: number } = {};
	if (document.status === "draft") updates.status = "sent";
	if (document.sentAt === undefined) updates.sentAt = now;
	if (updates.status !== undefined || updates.sentAt !== undefined) {
		if (attempt.document.type === "invoice") {
			await ctx.db.patch(attempt.document.id, updates);
		} else if (attempt.document.type === "quote") {
			await ctx.db.patch(attempt.document.id, updates);
		} else {
			await ctx.db.patch(attempt.document.id, updates);
		}
	}
	return {
		lifecycle:
			updates.status !== undefined || updates.sentAt !== undefined
				? "advanced"
				: "preserved",
		keepPortalActionable: hasSendableDocumentStatus(attempt.document, document),
	};
}

async function revokeAttemptPortalCapability(
	ctx: MutationCtx,
	attempt: Doc<"documentEmailAttempts">,
) {
	const portalToken = await ctx.db.get(attempt.portalTokenId);
	if (
		portalToken &&
		portalToken.siteUrl === attempt.siteUrl &&
		portalToken.type === attempt.document.type &&
		portalToken.documentId === attempt.document.id &&
		portalToken.clientId === attempt.clientId &&
		portalToken.revokedAt === undefined
	) {
		await ctx.db.patch(portalToken._id, { used: true, revokedAt: Date.now() });
	}
}

async function inspectResolutionLifecycle(
	ctx: MutationCtx,
	attempt: Doc<"documentEmailAttempts">,
): Promise<ResolutionLifecycle> {
	const document = await loadDocument(ctx, attempt.document);
	if (!document) return "target_missing";
	return document.siteUrl === attempt.siteUrl && document.clientId === attempt.clientId
		? "preserved"
		: "target_mismatch";
}

export const prepare = mutation({
	args: {
		siteUrl: v.string(),
		attemptId: v.string(),
		document: documentEmailDocumentValidator,
		portalOrigin: v.string(),
		portalToken: v.string(),
		portalExpiresAt: v.optional(v.number()),
		envelope: documentEmailEnvelopeValidator,
	},
	handler: async (ctx, args) => {
		await requireSiteAdmin(ctx, args.siteUrl);
		if (!UUID_PATTERN.test(args.attemptId) || !UUID_PATTERN.test(args.portalToken)) {
			return prepareRejected("invalid_request");
		}
		let origin: string;
		try {
			origin = canonicalPortalOrigin(args.siteUrl, args.portalOrigin);
		} catch {
			return prepareRejected("invalid_request");
		}
		const portalUrl = portalUrlFor(origin, args.portalToken);
		const providerKey = providerIdempotencyKey(args.document, args.attemptId);
		if (byteLength(providerKey) > 256) {
			return prepareRejected("invalid_request");
		}
		const frozenProviderTags = providerTags(args.attemptId);
		const frozenDocumentKey = documentKey(args.document);

		const existing = await getAttempt(ctx, args.siteUrl, args.attemptId);
		if (existing) {
			if (
				existing.protocolVersion !== 1 ||
				!documentMatches(args.document, existing.document) ||
				existing.documentKey !== frozenDocumentKey ||
				existing.portalUrl !== portalUrl ||
				existing.requestedPortalExpiresAt !== args.portalExpiresAt ||
				existing.providerIdempotencyKey !== providerKey ||
				JSON.stringify(existing.providerTags) !== JSON.stringify(frozenProviderTags) ||
				!envelopeMatches(existing.envelope, args.envelope)
			) {
				return prepareRejected("attempt_conflict");
			}
			return { outcome: "replay" as const, attempt: existing };
		}

		// This indexed range read and the later insert share one Convex
		// transaction. Concurrent different UUIDs for the same document therefore
		// converge on one canonical open attempt through OCC retry.
		const openAttempt = await getOpenDocumentAttempt(ctx, args.siteUrl, args.document);
		if (openAttempt) {
			return { outcome: "blocked" as const, attempt: openAttempt };
		}

		const now = Date.now();
		let portalExpiresAt = args.portalExpiresAt;
		const document = await loadDocument(ctx, args.document);
		if (!document || document.siteUrl !== args.siteUrl) {
			return prepareRejected("document_unavailable");
		}
		if (!hasSendableDocumentStatus(args.document, document)) {
			return prepareRejected("document_not_sendable");
		}
		if (args.document.type === "quote") {
			const quote = document as Doc<"quotes">;
			const quoteExpiry =
				quote.validUntil === undefined
					? undefined
					: quoteValidUntilExclusiveUtcMs(quote.validUntil);
			if (quoteExpiry === null) return prepareRejected("portal_unavailable");
			if (quoteExpiry !== undefined) {
				portalExpiresAt =
					portalExpiresAt === undefined
						? quoteExpiry
						: Math.min(portalExpiresAt, quoteExpiry);
			}
		}
		if (
			portalExpiresAt !== undefined &&
			(!Number.isSafeInteger(portalExpiresAt) || portalExpiresAt <= now)
		) {
			return prepareRejected("portal_unavailable");
		}
		const client = await ctx.db.get(document.clientId);
		if (!client || client.siteUrl !== args.siteUrl) {
			return prepareRejected("client_unavailable");
		}
		if (!client.email) {
			return prepareRejected("client_unavailable");
		}
		try {
			validateEnvelope(args.envelope, portalUrl, client.email);
		} catch {
			return prepareRejected("message_invalid");
		}

		const existingPortalToken = await ctx.db
			.query("portalTokens")
			.withIndex("by_token", (q) => q.eq("token", args.portalToken))
			.unique();
		if (existingPortalToken) {
			return prepareRejected("portal_token_conflict");
		}
		// Keep accepted replacement rotation exhaustively bounded before creating
		// either the portal capability or its durable send journal. The indexed
		// range read participates in the same transaction, so concurrent creators
		// cannot both cross the limit.
		const existingCapabilities = await loadPortalCapabilityRange(ctx, args.document.id);
		if (
			existingCapabilities.length >=
			DOCUMENT_EMAIL_MAX_PORTAL_CAPABILITIES_PER_DOCUMENT
		) {
			return prepareRejected("portal_unavailable");
		}
		const portalTokenId = await ctx.db.insert("portalTokens", {
			token: args.portalToken,
			siteUrl: args.siteUrl,
			type: args.document.type,
			documentId: args.document.id,
			clientId: document.clientId,
			expiresAt: portalExpiresAt,
			used: false,
		});
		const id = await ctx.db.insert("documentEmailAttempts", {
			protocolVersion: 1,
			siteUrl: args.siteUrl,
			attemptId: args.attemptId,
			document: args.document,
			documentKey: frozenDocumentKey,
			open: true,
			providerRetryBlocked: false,
			clientId: document.clientId,
			portalTokenId,
			portalUrl,
			requestedPortalExpiresAt: args.portalExpiresAt,
			portalExpiresAt,
			envelope: args.envelope,
			providerIdempotencyKey: providerKey,
			providerTags: frozenProviderTags,
			status: "prepared",
			claimCount: 0,
			createdAt: now,
			updatedAt: now,
		});
		const attempt = await ctx.db.get(id);
		if (!attempt) throw new Error("Document email attempt was not stored");
		return { outcome: "prepared" as const, attempt };
	},
});

export const get = query({
	args: { siteUrl: v.string(), attemptId: v.string() },
	handler: async (ctx, { siteUrl, attemptId }) => {
		await requireSiteAdmin(ctx, siteUrl);
		requireUuid(attemptId, "Attempt ID");
		return await getAttempt(ctx, siteUrl, attemptId);
	},
});

/**
 * Authenticated browser-safe recovery state. The full `get` result remains
 * server-only because exact same-key provider replay needs its frozen envelope,
 * portal link, idempotency key, and tags; none of those are serialized here.
 */
export const getRecovery = query({
	args: { siteUrl: v.string(), attemptId: v.string() },
	handler: async (ctx, { siteUrl, attemptId }) => {
		await requireSiteAdmin(ctx, siteUrl);
		if (!UUID_PATTERN.test(attemptId)) return null;
		const attempt = await getAttempt(ctx, siteUrl, attemptId);
		return attempt ? recoveryProjection(attempt, Date.now()) : null;
	},
});

/**
 * Discover the one open recovery journal for a document without exposing its
 * frozen provider request. The open-attempt index is also the transactional
 * preparation fence; only its prepared/claimed/uncertain states are eligible.
 */
export const getOpenRecoveryByDocument = query({
	args: {
		siteUrl: v.string(),
		document: documentEmailDocumentValidator,
	},
	handler: async (ctx, { siteUrl, document }) => {
		await requireSiteAdmin(ctx, siteUrl);
		const attempt = await getOpenDocumentAttempt(ctx, siteUrl, document);
		if (
			!attempt ||
			!attempt.open ||
			(attempt.status !== "prepared" &&
				attempt.status !== "claimed" &&
				attempt.status !== "uncertain")
		) {
			return null;
		}
		return recoveryProjection(attempt, Date.now());
	},
});

export const claim = mutation({
	args: {
		siteUrl: v.string(),
		attemptId: v.string(),
		claimId: v.string(),
	},
	handler: async (ctx, { siteUrl, attemptId, claimId }) => {
		await requireSiteAdmin(ctx, siteUrl);
		requireUuid(attemptId, "Attempt ID");
		requireUuid(claimId, "Claim ID");
		const attempt = requireAttempt(await getAttempt(ctx, siteUrl, attemptId));
		if (attempt.status === "sent") {
			return { outcome: "sent" as const, attempt };
		}
		if (attempt.status === "failed") {
			return { outcome: "failed" as const, attempt };
		}
		if (attempt.status === "resolved_not_sent") {
			return { outcome: "released" as const, attempt };
		}
		if (attempt.providerRetryBlocked) {
			return { outcome: "uncertain" as const, attempt };
		}
		const now = Date.now();
		if (attempt.status === "uncertain") {
			// Resend guarantees one result for an identical idempotency key for 24h.
			// Reclaim only inside a shorter safety window, only when no accepted
			// provider ID is already known, and with a hard attempt bound.
			if (
				attempt.providerMessageId !== undefined ||
				now - attempt.createdAt >= DOCUMENT_EMAIL_RECONCILIATION_WINDOW_MS ||
				attempt.claimCount >= DOCUMENT_EMAIL_MAX_CLAIMS
			) {
				return { outcome: "uncertain" as const, attempt };
			}
		}
		if (attempt.status === "claimed") {
			if (attempt.claimExpiresAt === undefined || attempt.claimExpiresAt <= now) {
				const failure = "Provider delivery outcome is unknown because the send claim expired";
				await ctx.db.patch(attempt._id, {
					status: "uncertain",
					failure,
					updatedAt: now,
				});
				const uncertain = await ctx.db.get(attempt._id);
				if (!uncertain) throw new Error("Document email attempt was not stored");
				return { outcome: "uncertain" as const, attempt: uncertain };
			}
			if (attempt.claimId === claimId) {
				const capacity = await checkProviderClaimCapacity(ctx, attempt);
				if (!capacity.valid) {
					return await refuseProviderClaim(ctx, attempt, now, capacity);
				}
				const check = await checkClaimTarget(ctx, attempt, now);
				if (!check.valid) return await refuseProviderClaim(ctx, attempt, now, check);
				return { outcome: "claimed" as const, attempt };
			}
			return { outcome: "busy" as const, attempt };
		}

		const capacity = await checkProviderClaimCapacity(ctx, attempt);
		if (!capacity.valid) return await refuseProviderClaim(ctx, attempt, now, capacity);

		const check = await checkClaimTarget(ctx, attempt, now);
		if (!check.valid) return await refuseProviderClaim(ctx, attempt, now, check);

		const claimExpiresAt = now + DOCUMENT_EMAIL_CLAIM_LEASE_MS;
		await ctx.db.patch(attempt._id, {
			status: "claimed",
			claimCount: attempt.claimCount + 1,
			claimId,
			claimedAt: now,
			claimExpiresAt,
			failure: undefined,
			updatedAt: now,
		});
		await ctx.scheduler.runAt(claimExpiresAt, expireClaimReference, {
			attemptId: attempt._id,
			claimId,
			claimExpiresAt,
		});
		const claimed = await ctx.db.get(attempt._id);
		if (!claimed) throw new Error("Document email attempt was not stored");
		return { outcome: "claimed" as const, attempt: claimed };
	},
});

export const expireClaim = internalMutation({
	args: {
		attemptId: v.id("documentEmailAttempts"),
		claimId: v.string(),
		claimExpiresAt: v.number(),
	},
	handler: async (ctx, { attemptId, claimId, claimExpiresAt }) => {
		const attempt = await ctx.db.get(attemptId);
		if (
			!attempt ||
			attempt.status !== "claimed" ||
			attempt.claimId !== claimId ||
			attempt.claimExpiresAt !== claimExpiresAt ||
			Date.now() < claimExpiresAt
		) {
			return false;
		}
		await ctx.db.patch(attemptId, {
			status: "uncertain",
			failure: "Provider delivery outcome is unknown because the send claim expired",
			updatedAt: Date.now(),
		});
		return true;
	},
});

export const complete = mutation({
	args: {
		siteUrl: v.string(),
		attemptId: v.string(),
		claimId: v.string(),
		providerMessageId: v.string(),
	},
	handler: async (ctx, { siteUrl, attemptId, claimId, providerMessageId }) => {
		await requireSiteAdmin(ctx, siteUrl);
		requireUuid(attemptId, "Attempt ID");
		requireUuid(claimId, "Claim ID");
		requireBoundedText(providerMessageId, "Provider message ID", MAX_ADDRESS_BYTES);
		const attempt = requireAttempt(await getAttempt(ctx, siteUrl, attemptId));
		if (attempt.status === "sent") {
			if (attempt.claimId !== claimId || attempt.providerMessageId !== providerMessageId) {
				throw new Error("Document email completion conflicts with the sent attempt");
			}
			return { outcome: "replay" as const, attempt };
		}
		if (
			(attempt.status !== "claimed" && attempt.status !== "uncertain") ||
			attempt.claimId !== claimId
		) {
			throw new Error("Document email attempt cannot be completed by this claim");
		}
		if (
			attempt.providerMessageId !== undefined &&
			attempt.providerMessageId !== providerMessageId
		) {
			throw new Error(
				"Document email completion conflicts with the accepted provider message",
			);
		}

		const now = Date.now();
		const description = await completeDocumentLifecycle(ctx, attempt, now);
		await retirePriorPortalCapabilities(ctx, attempt, now);
		const emailLogId = await ctx.db.insert("emailLog", {
			siteUrl,
			to: attempt.envelope.to,
			subject: attempt.envelope.subject,
			type: attempt.document.type,
			relatedId: attempt.document.id,
			status: "sent",
			resendId: providerMessageId,
		});
		const activityLogId = await ctx.db.insert("activityLog", {
			siteUrl,
			clientId: attempt.clientId,
			action: `${attempt.document.type}_sent`,
			description,
			metadata: JSON.stringify({
				docType: attempt.document.type,
				docId: attempt.document.id,
				emailAttemptId: attemptId,
			}),
		});
		await ctx.db.patch(attempt._id, {
			status: "sent",
			open: false,
			providerMessageId,
			failure: undefined,
			emailLogId,
			activityLogId,
			updatedAt: now,
			terminalAt: now,
		});
		const completed = await ctx.db.get(attempt._id);
		if (!completed) throw new Error("Document email attempt was not stored");
		return { outcome: "sent" as const, attempt: completed };
	},
});

/**
 * Operator-authoritative resolution for an open ambiguous attempt. This never
 * contacts the provider. Positive evidence records accepted-provider truth;
 * negative evidence is delayed until the provider idempotency window is safely
 * past unless no provider claim was ever granted.
 */
export const resolve = mutation({
	args: {
		siteUrl: v.string(),
		attemptId: v.string(),
		expectedDocument: documentEmailDocumentValidator,
		resolution: documentEmailResolutionValidator,
	},
	handler: async (ctx, { siteUrl, attemptId, expectedDocument, resolution }) => {
		const { identity } = await requireSiteAdmin(ctx, siteUrl);
		if (!UUID_PATTERN.test(attemptId)) {
			resolutionError(
				DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.notFound,
				"Document email attempt not found",
			);
		}
		const attempt = await getAttempt(ctx, siteUrl, attemptId);
		if (!attempt) {
			resolutionError(
				DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.notFound,
				"Document email attempt not found",
			);
		}
		if (!documentMatches(expectedDocument, attempt.document)) {
			resolutionError(
				DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.documentMismatch,
				"Document email attempt does not match the expected document",
			);
		}
		const now = Date.now();

		let normalizedNote: string | undefined;
		if (resolution.kind === "not_accepted") {
			normalizedNote = resolution.note.trim();
			if (
				!normalizedNote ||
				byteLength(normalizedNote) > MAX_RESOLUTION_NOTE_BYTES
			) {
				resolutionError(
					DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.invalidResolution,
					"Resolution note is invalid",
				);
			}
		} else if (
			resolution.providerMessageId !== undefined &&
			(!resolution.providerMessageId ||
				resolution.providerMessageId !== resolution.providerMessageId.trim() ||
				/[\r\n]/.test(resolution.providerMessageId) ||
				byteLength(resolution.providerMessageId) > MAX_ADDRESS_BYTES)
		) {
			resolutionError(
				DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.invalidResolution,
				"Provider message ID is invalid",
			);
		}

		if (attempt.resolution) {
			if (
				attempt.resolution.kind !== resolution.kind ||
				(resolution.kind === "accepted" &&
					resolution.providerMessageId !== undefined &&
					resolution.providerMessageId !== attempt.providerMessageId) ||
				(resolution.kind === "not_accepted" &&
					normalizedNote !== attempt.resolution.note)
			) {
				resolutionError(
					DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.resolutionConflict,
					"Document email resolution conflicts with its recorded outcome",
				);
			}
			return {
				outcome: "replay" as const,
				recovery: recoveryProjection(attempt, now),
			};
		}

		if (attempt.status === "sent" && resolution.kind === "accepted") {
			if (
				resolution.providerMessageId !== undefined &&
				resolution.providerMessageId !== attempt.providerMessageId
			) {
				resolutionError(
					DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.providerEvidenceConflict,
					"Provider message ID conflicts with the sent attempt",
				);
			}
			return {
				outcome: "replay" as const,
				recovery: recoveryProjection(attempt, now),
			};
		}
		if (!attempt.open) {
			resolutionError(
				DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.terminal,
				"Document email attempt is already terminal",
			);
		}

		if (resolution.kind === "accepted") {
			if (
				attempt.providerMessageId !== undefined &&
				resolution.providerMessageId !== undefined &&
				attempt.providerMessageId !== resolution.providerMessageId
			) {
				resolutionError(
					DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.providerEvidenceConflict,
					"Provider message ID conflicts with the recorded provider evidence",
				);
			}
			const providerMessageId =
				attempt.providerMessageId ?? resolution.providerMessageId;
			if (!providerMessageId) {
				resolutionError(
					DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.providerEvidenceRequired,
					"Provider acceptance requires a provider message ID",
				);
			}
			if (attempt.providerMessageId === undefined) {
				if (hasLiveClaim(attempt, now)) {
					resolutionError(
						DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.liveClaim,
						"Provider acceptance cannot be recorded while delivery is in progress",
					);
				}
				if (attempt.claimCount === 0) {
					resolutionError(
						DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.notEligible,
						"This attempt never granted provider delivery work",
					);
				}
			}

			const targetCheck = await checkClaimTarget(ctx, attempt, now);
			const lifecycleResult = await applyAcceptedResolutionLifecycle(
				ctx,
				attempt,
				now,
			);
			if (targetCheck.valid && lifecycleResult.keepPortalActionable) {
				await retirePriorPortalCapabilities(ctx, attempt, now);
			} else {
				await revokeAttemptPortalCapability(ctx, attempt);
			}
			const emailLogId = await ctx.db.insert("emailLog", {
				siteUrl,
				to: attempt.envelope.to,
				subject: attempt.envelope.subject,
				type: attempt.document.type,
				relatedId: attempt.document.id,
				status: "sent",
				resendId: providerMessageId,
			});
			const activityLogId = await ctx.db.insert("activityLog", {
				siteUrl,
				clientId: attempt.clientId,
				action: `${attempt.document.type}_sent`,
				description: `${attempt.document.type} email delivery accepted by provider`,
				metadata: JSON.stringify({
					docType: attempt.document.type,
					docId: attempt.document.id,
					emailAttemptId: attempt.attemptId,
					operatorResolution: true,
					lifecycle: lifecycleResult.lifecycle,
				}),
			});
			await ctx.db.patch(attempt._id, {
				status: "sent",
				open: false,
				providerMessageId,
				failure: undefined,
				emailLogId,
				activityLogId,
				updatedAt: now,
				terminalAt: now,
				resolution: {
					kind: "accepted",
					source:
						attempt.providerMessageId !== undefined
							? "stored_provider_id"
							: "operator_provider_id",
					resolvedAt: now,
					resolvedByTokenIdentifier: identity.tokenIdentifier,
					...(identity.email ? { resolvedByEmail: identity.email } : {}),
					priorStatus: attempt.status,
					priorClaimCount: attempt.claimCount,
					lifecycle: lifecycleResult.lifecycle,
				},
			});
			const resolved = await ctx.db.get(attempt._id);
			if (!resolved) throw new Error("Document email attempt was not stored");
			return {
				outcome: "sent" as const,
				recovery: recoveryProjection(resolved, now),
			};
		}

		if (attempt.providerMessageId !== undefined) {
			resolutionError(
				DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.providerEvidenceConflict,
				"A provider-accepted attempt cannot be released as not accepted",
			);
		}
		if (hasLiveClaim(attempt, now)) {
			resolutionError(
				DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.liveClaim,
				"Document email delivery is still in progress",
			);
		}
		if (now < resolveNotAcceptedAt(attempt)) {
			resolutionError(
				DOCUMENT_EMAIL_RESOLUTION_ERROR_CODES.notEligible,
				"Provider non-acceptance cannot yet be recorded safely",
			);
		}

		const lifecycle = await inspectResolutionLifecycle(ctx, attempt);
		await revokeAttemptPortalCapability(ctx, attempt);
		const activityLogId = await ctx.db.insert("activityLog", {
			siteUrl,
			clientId: attempt.clientId,
			action: `${attempt.document.type}_email_not_accepted`,
			description: `${attempt.document.type} email provider non-acceptance verified`,
			metadata: JSON.stringify({
				docType: attempt.document.type,
				docId: attempt.document.id,
				emailAttemptId: attempt.attemptId,
				operatorResolution: true,
			}),
		});
		await ctx.db.patch(attempt._id, {
			status: "resolved_not_sent",
			open: false,
			providerRetryBlocked: true,
			failure: "Provider non-acceptance verified by an administrator",
			activityLogId,
			updatedAt: now,
			terminalAt: now,
			resolution: {
				kind: "not_accepted",
				source: "operator_not_accepted",
				resolvedAt: now,
				resolvedByTokenIdentifier: identity.tokenIdentifier,
				...(identity.email ? { resolvedByEmail: identity.email } : {}),
				priorStatus: attempt.status,
				priorClaimCount: attempt.claimCount,
				lifecycle,
				note: normalizedNote,
			},
		});
		const released = await ctx.db.get(attempt._id);
		if (!released) throw new Error("Document email attempt was not stored");
		return {
			outcome: "released" as const,
			recovery: recoveryProjection(released, now),
		};
	},
});

export const fail = mutation({
	args: {
		siteUrl: v.string(),
		attemptId: v.string(),
		claimId: v.string(),
		disposition: v.union(v.literal("failed"), v.literal("uncertain")),
		error: v.string(),
		providerMessageId: v.optional(v.string()),
	},
	handler: async (
		ctx,
		{ siteUrl, attemptId, claimId, disposition, error, providerMessageId },
	) => {
		await requireSiteAdmin(ctx, siteUrl);
		requireUuid(attemptId, "Attempt ID");
		requireUuid(claimId, "Claim ID");
		validateFailure(error);
		if (providerMessageId !== undefined) {
			requireBoundedText(providerMessageId, "Provider message ID", MAX_ADDRESS_BYTES);
			if (disposition !== "uncertain") {
				throw new Error("A provider-accepted message cannot be recorded as failed");
			}
		}
		const attempt = requireAttempt(await getAttempt(ctx, siteUrl, attemptId));
		if (attempt.status === "sent") {
			if (
				disposition === "uncertain" &&
				providerMessageId !== undefined &&
				attempt.claimId === claimId &&
				attempt.providerMessageId === providerMessageId
			) {
				return { outcome: "replay" as const, attempt };
			}
			throw new Error("A sent document email attempt cannot fail");
		}
		if (attempt.status === "resolved_not_sent") {
			throw new Error("A released document email attempt cannot fail");
		}
		if (attempt.claimId !== claimId) {
			throw new Error("Document email attempt cannot be failed by this claim");
		}
		if (attempt.providerMessageId !== undefined && disposition === "failed") {
			throw new Error("A provider-accepted message cannot be recorded as failed");
		}
		if (
			attempt.providerMessageId !== undefined &&
			providerMessageId !== undefined &&
			attempt.providerMessageId !== providerMessageId
		) {
			throw new Error(
				"Document email failure conflicts with the accepted provider message",
			);
		}
		const exactReplay =
			attempt.status === disposition &&
			attempt.failure === error &&
			(providerMessageId === undefined || attempt.providerMessageId === providerMessageId);
		if (exactReplay) {
			return { outcome: "replay" as const, attempt };
		}
		if (attempt.status === "uncertain") {
			throw new Error(
				"An uncertain document email attempt requires audited operator resolution",
			);
		}
		if (attempt.status !== "claimed") {
			throw new Error("Document email attempt failure conflicts with its state");
		}

		const now = Date.now();
		let emailLogId = attempt.emailLogId;
		if (disposition === "failed") {
			await revokeAttemptPortalCapability(ctx, attempt);
		}
		if (disposition === "failed" && emailLogId === undefined) {
			emailLogId = await ctx.db.insert("emailLog", {
				siteUrl,
				to: attempt.envelope.to,
				subject: attempt.envelope.subject,
				type: attempt.document.type,
				relatedId: attempt.document.id,
				status: "failed",
				error,
			});
		}
		await ctx.db.patch(attempt._id, {
			status: disposition,
			open: disposition !== "failed",
			failure: error,
			providerMessageId: providerMessageId ?? attempt.providerMessageId,
			emailLogId,
			updatedAt: now,
			terminalAt: disposition === "failed" ? now : undefined,
		});
		const failed = await ctx.db.get(attempt._id);
		if (!failed) throw new Error("Document email attempt was not stored");
		return { outcome: disposition, attempt: failed };
	},
});
