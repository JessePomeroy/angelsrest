import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import type { ContentSlugKind, PublishedSlugChange } from "./contentValidators";

type ContentSlugCtx = MutationCtx | QueryCtx;

function kindLabel(kind: ContentSlugKind) {
	if (kind === "author") return "Author";
	if (kind === "category") return "Category";
	return "Post";
}

async function getCurrentSlugOwner(
	ctx: ContentSlugCtx,
	siteUrl: string,
	kind: ContentSlugKind,
	slug: string,
) {
	return await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_slug", (q) =>
			q.eq("siteUrl", siteUrl).eq("kind", kind).eq("slug", slug),
		)
		.unique();
}

export async function getContentSlugHistoryOwner(
	ctx: ContentSlugCtx,
	args: { siteUrl: string; kind: ContentSlugKind; slug: string },
) {
	return await ctx.db
		.query("contentSlugHistory")
		.withIndex("by_siteUrl_and_kind_and_slug", (q) =>
			q.eq("siteUrl", args.siteUrl).eq("kind", args.kind).eq("slug", args.slug),
		)
		.unique();
}

/**
 * Reserve current and historical slugs inside one tenant and content
 * namespace. A document may deliberately return to one of its own former
 * slugs, but no other document can claim any part of that history. Drafts are
 * checked for early feedback but do not squat an unpublished URL indefinitely;
 * the authoritative collision check runs again inside publication.
 */
export async function requireContentSlugAvailable(
	ctx: ContentSlugCtx,
	args: {
		siteUrl: string;
		kind: ContentSlugKind;
		slug: string | undefined;
		documentId?: Id<"contentDocuments">;
	},
) {
	if (!args.slug) return;
	const [currentOwner, historicalOwner] = await Promise.all([
		getCurrentSlugOwner(ctx, args.siteUrl, args.kind, args.slug),
		getContentSlugHistoryOwner(ctx, {
			siteUrl: args.siteUrl,
			kind: args.kind,
			slug: args.slug,
		}),
	]);
	if (
		(currentOwner && currentOwner._id !== args.documentId) ||
		(historicalOwner && historicalOwner.documentId !== args.documentId)
	) {
		throw new Error(`${kindLabel(args.kind)} slug "${args.slug}" is reserved`);
	}
}

/** Require an exact old/new acknowledgement only for a real live URL change. */
export function requirePublishedSlugChangeIntent(args: {
	document: Doc<"contentDocuments">;
	nextSlug: string;
	intent: PublishedSlugChange | undefined;
}) {
	const previousSlug = args.document.slug;
	const changesPublishedSlug =
		args.document.publishedRevisionId !== undefined && previousSlug !== args.nextSlug;
	if (!changesPublishedSlug) {
		if (args.intent) {
			throw new Error("Published URL change acknowledgement is not applicable");
		}
		return;
	}
	if (
		!previousSlug ||
		args.intent?.fromSlug !== previousSlug ||
		args.intent.toSlug !== args.nextSlug
	) {
		throw new Error(
			"Published URL change requires an exact current and proposed slug acknowledgement",
		);
	}
}

/** Preserve exact-retry semantics after the acknowledged change has committed. */
export async function requireValidPublishedSlugChangeRetry(
	ctx: ContentSlugCtx,
	args: {
		document: Doc<"contentDocuments">;
		kind: ContentSlugKind;
		intent: PublishedSlugChange | undefined;
	},
) {
	if (!args.intent) return;
	if (
		!args.document.slug ||
		args.intent.toSlug !== args.document.slug ||
		args.intent.fromSlug === args.intent.toSlug
	) {
		throw new Error("Published URL change retry does not match the current slug");
	}
	const retained = await getContentSlugHistoryOwner(ctx, {
		siteUrl: args.document.siteUrl,
		kind: args.kind,
		slug: args.intent.fromSlug,
	});
	if (retained?.documentId !== args.document._id) {
		throw new Error("Published URL change retry does not match retained history");
	}
}

/** Retain the former live slug in the same transaction that publishes its replacement. */
export async function retainPreviousPublishedSlug(
	ctx: MutationCtx,
	args: {
		document: Doc<"contentDocuments">;
		kind: ContentSlugKind;
		nextSlug: string;
		actor: string;
		now: number;
	},
) {
	if (!args.document.publishedRevisionId) return;
	const previousSlug = args.document.slug;
	if (!previousSlug || previousSlug === args.nextSlug) return;
	const existing = await getContentSlugHistoryOwner(ctx, {
		siteUrl: args.document.siteUrl,
		kind: args.kind,
		slug: previousSlug,
	});
	if (existing) {
		if (existing.documentId !== args.document._id) {
			throw new Error(`${kindLabel(args.kind)} slug "${previousSlug}" is reserved`);
		}
		return;
	}
	await ctx.db.insert("contentSlugHistory", {
		siteUrl: args.document.siteUrl,
		kind: args.kind,
		slug: previousSlug,
		documentId: args.document._id,
		createdAt: args.now,
		createdBy: args.actor,
	});
}
