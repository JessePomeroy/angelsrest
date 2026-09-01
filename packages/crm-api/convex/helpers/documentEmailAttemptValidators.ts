import { v } from "convex/values";

export const documentEmailDocumentValidator = v.union(
	v.object({
		type: v.literal("invoice"),
		id: v.id("invoices"),
	}),
	v.object({
		type: v.literal("quote"),
		id: v.id("quotes"),
	}),
	v.object({
		type: v.literal("contract"),
		id: v.id("contracts"),
	}),
);

export const documentEmailEnvelopeValidator = v.object({
	from: v.string(),
	to: v.string(),
	replyTo: v.optional(v.string()),
	subject: v.string(),
	text: v.string(),
	html: v.string(),
});

export const documentEmailAttemptStatusValidator = v.union(
	v.literal("prepared"),
	v.literal("claimed"),
	v.literal("sent"),
	v.literal("failed"),
	v.literal("uncertain"),
	v.literal("resolved_not_sent"),
);

export const documentEmailProviderTagValidator = v.object({
	name: v.string(),
	value: v.string(),
});

export const documentEmailResolutionAuditValidator = v.object({
	kind: v.union(v.literal("accepted"), v.literal("not_accepted")),
	source: v.union(
		v.literal("stored_provider_id"),
		v.literal("operator_provider_id"),
		v.literal("operator_not_accepted"),
	),
	resolvedAt: v.number(),
	resolvedByTokenIdentifier: v.string(),
	resolvedByEmail: v.optional(v.string()),
	priorStatus: documentEmailAttemptStatusValidator,
	priorClaimCount: v.number(),
	lifecycle: v.union(
		v.literal("advanced"),
		v.literal("preserved"),
		v.literal("target_missing"),
		v.literal("target_mismatch"),
	),
	note: v.optional(v.string()),
});

export const documentEmailResolutionValidator = v.union(
	v.object({
		kind: v.literal("accepted"),
		providerMessageId: v.optional(v.string()),
	}),
	v.object({
		kind: v.literal("not_accepted"),
		confirmation: v.literal("NOT ACCEPTED"),
		note: v.string(),
	}),
);
