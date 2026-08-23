import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
	assertBlogDocument,
	checksumBlogDraft,
	listBlogDocuments,
	loadBlogRevision,
	requireReadyAuthorPortrait,
} from "./blogContentData";
import {
	blogContentChecksumInput,
	type BlogSupportingDraft,
	toPublishedBlogSupportingContent,
} from "./blogContentValidators";
import { requireActiveContentDocument } from "./contentLifecycle";
import { requireContentSlugAvailable } from "./contentSlugHistory";
import {
	assertPostDocument,
	checksumPostDraft,
	listPostDocuments,
	loadPostRevision,
	normalizePostDraftIds,
	requirePostDraftRelations,
} from "./postContentGraph";
import type { PostDraft } from "./postContentValidators";
import { toPublishedPostDraft } from "./postContentValidators";
import {
	requireSanityBlogReconciliationPlan,
	resolveSanityBlogReconciliationPostDraft,
	type SanityBlogReconciliationPlan,
} from "./sanityBlogReconciliationPlan";

type PublicationKind = "author" | "category" | "post";
type PlanItem =
	| SanityBlogReconciliationPlan["authors"][number]
	| SanityBlogReconciliationPlan["categories"][number]
	| SanityBlogReconciliationPlan["posts"][number];

type PublicationItem = {
	kind: PublicationKind;
	item: PlanItem;
};

type PreparedSupporting = {
	kind: "author" | "category";
	item: SanityBlogReconciliationPlan["authors"][number];
	document: ReturnType<typeof assertBlogDocument>;
	revisionId: Id<"contentRevisions">;
	draft: BlogSupportingDraft;
};

type PreparedPost = {
	kind: "post";
	item: SanityBlogReconciliationPlan["posts"][number];
	document: ReturnType<typeof assertPostDocument>;
	revisionId: Id<"contentRevisions">;
	draft: PostDraft;
};

type PreparedItem = PreparedSupporting | PreparedPost;
type PublicationMode = "publish" | "replay";

const EXPECTED_COUNTS = { authors: 1, categories: 1, posts: 4 } as const;
const PARTIAL_ERROR = "Blog fixed-manifest publication is partial or drifted";

function reconciliationActor(plan: SanityBlogReconciliationPlan, digest: string) {
	return `sanityReconcile:${plan.migrationId}:${plan.decisionSet.id}:${digest}`;
}

function publicationActor(plan: SanityBlogReconciliationPlan, digest: string) {
	return `sanityPublish:${plan.migrationId}:${plan.decisionSet.id}:${digest}`;
}

function planItems(plan: SanityBlogReconciliationPlan): PublicationItem[] {
	return [
		...plan.authors.map((item) => ({ kind: "author" as const, item })),
		...plan.categories.map((item) => ({ kind: "category" as const, item })),
		...plan.posts.map((item) => ({ kind: "post" as const, item })),
	];
}

function requireExactModuleShape(plan: SanityBlogReconciliationPlan) {
	if (
		plan.authors.length !== EXPECTED_COUNTS.authors
		|| plan.categories.length !== EXPECTED_COUNTS.categories
		|| plan.posts.length !== EXPECTED_COUNTS.posts
	) {
		throw new Error("Blog fixed-manifest publication requires exactly 1 Author, 1 Category, and 4 Posts");
	}
}

async function loadExactDocuments(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
	items: PublicationItem[],
) {
	const documents = await Promise.all(
		items.map(async ({ kind, item }) => {
			const stored = await ctx.db.get(item.target.documentId);
			if (!stored || stored.siteUrl !== plan.siteUrl || stored.kind !== kind) {
				throw new Error("Blog publication target identity drifted");
			}
			const document = kind === "post"
				? assertPostDocument(stored)
				: assertBlogDocument(stored, kind);
			if (
				document.documentKey !== item.documentKey
				|| document.rank !== item.target.rank
				|| document.slug !== item.draft.slug
			) throw new Error("Blog publication target identity drifted");
			requireActiveContentDocument(document, "Blog publication target");
			return document;
		}),
	);
	if (new Set(documents.map(({ _id }) => _id)).size !== items.length) {
		throw new Error("Blog publication targets must be unique");
	}
	return documents;
}

async function requireNoOutsidePublishedDocuments(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
	documents: Doc<"contentDocuments">[],
) {
	const [authors, categories, posts] = await Promise.all([
		listBlogDocuments(ctx, plan.siteUrl, "author"),
		listBlogDocuments(ctx, plan.siteUrl, "category"),
		listPostDocuments(ctx, plan.siteUrl),
	]);
	const manifestIds = new Set(documents.map(({ _id }) => _id));
	const published = [...authors, ...categories, ...posts].filter(
		(document) => document.publishedRevisionId !== undefined,
	);
	if (published.some(({ _id }) => !manifestIds.has(_id))) {
		throw new Error("Blog fixed-manifest publication found an outside published document");
	}
	return published;
}

function publicationMode(
	documents: Doc<"contentDocuments">[],
	published: Doc<"contentDocuments">[],
): PublicationMode {
	const readyToPublish = documents.every(
		(document) =>
			document.draftRevisionId !== undefined
			&& document.publishedRevisionId === undefined
			&& document.publishedAt === undefined
			&& document.publishedBy === undefined,
	);
	if (readyToPublish && published.length === 0) return "publish";
	const exactReplay =
		published.length === documents.length
		&& documents.every(
			(document) =>
				document.draftRevisionId === undefined
				&& document.publishedRevisionId !== undefined
				&& document.publishedAt !== undefined
				&& document.publishedBy !== undefined,
		);
	if (exactReplay) return "replay";
	throw new Error(PARTIAL_ERROR);
}

async function requireExactRevisionSet(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
	baselineRevisionId: Id<"contentRevisions">,
	currentRevisionId: Id<"contentRevisions">,
) {
	if (currentRevisionId === baselineRevisionId) {
		throw new Error("Blog publication target was not reconciled");
	}
	const revisions = await ctx.db
		.query("contentRevisions")
		.withIndex("by_documentId_and_createdAt", (q) => q.eq("documentId", document._id))
		.take(3);
	if (
		revisions.length !== 2
		|| !revisions.some(({ _id }) => _id === baselineRevisionId)
		|| !revisions.some(({ _id }) => _id === currentRevisionId)
	) throw new Error("Blog publication revision set drifted");
}

function requireReconciliationProvenance(
	revision: Doc<"contentRevisions">,
	document: Doc<"contentDocuments">,
	actor: string,
) {
	if (
		revision.documentId !== document._id
		|| revision.siteUrl !== document.siteUrl
		|| revision.kind !== document.kind
		|| revision.source !== "sanityImport"
		|| revision.createdBy !== actor
		|| revision.restoredFromRevisionId !== undefined
		|| revision.restoreOperationId !== undefined
		|| revision.restoreRequestDigest !== undefined
	) throw new Error("Blog publication reconciliation provenance drifted");
}

async function prepareSupporting(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
	entry: PublicationItem,
	document: Doc<"contentDocuments">,
	mode: PublicationMode,
	actor: string,
): Promise<PreparedSupporting> {
	if (entry.kind === "post") throw new Error("Blog supporting publication kind drifted");
	const item = entry.item as SanityBlogReconciliationPlan["authors"][number];
	if (item.draft.kind !== entry.kind) throw new Error("Blog supporting publication kind drifted");
	const validated = assertBlogDocument(document, entry.kind);
	const revisionId = mode === "publish"
		? validated.draftRevisionId
		: validated.publishedRevisionId;
	if (!revisionId) throw new Error(PARTIAL_ERROR);
	await requireExactRevisionSet(ctx, validated, item.target.draftRevisionId, revisionId);
	const loaded = await loadBlogRevision(ctx, validated, revisionId);
	if (!loaded) throw new Error("Blog publication supporting revision is missing");
	requireReconciliationProvenance(loaded.revision, validated, actor);
	const expectedChecksum = await checksumBlogDraft(blogContentChecksumInput(item.draft));
	const actualChecksum = await checksumBlogDraft(blogContentChecksumInput(loaded.draft));
	if (
		loaded.revision.checksum !== expectedChecksum
		|| actualChecksum !== expectedChecksum
	) throw new Error("Blog publication supporting revision drifted");
	const published = toPublishedBlogSupportingContent(loaded.draft);
	if (published.slug !== validated.slug) {
		throw new Error("Blog publication supporting slug drifted");
	}
	await requireContentSlugAvailable(ctx, {
		siteUrl: plan.siteUrl,
		kind: entry.kind,
		slug: published.slug,
		documentId: validated._id,
	});
	await requireReadyAuthorPortrait(ctx, plan.siteUrl, loaded.draft);
	return { kind: entry.kind, item, document: validated, revisionId, draft: loaded.draft };
}

async function preparePost(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
	entry: PublicationItem,
	document: Doc<"contentDocuments">,
	mode: PublicationMode,
	actor: string,
): Promise<PreparedPost> {
	if (entry.kind !== "post") throw new Error("Blog Post publication kind drifted");
	const item = entry.item as SanityBlogReconciliationPlan["posts"][number];
	const validated = assertPostDocument(document);
	const revisionId = mode === "publish"
		? validated.draftRevisionId
		: validated.publishedRevisionId;
	if (!revisionId) throw new Error(PARTIAL_ERROR);
	await requireExactRevisionSet(ctx, validated, item.target.draftRevisionId, revisionId);
	const loaded = await loadPostRevision(ctx, validated, revisionId);
	if (!loaded) throw new Error("Blog publication Post revision is missing");
	requireReconciliationProvenance(loaded.revision, validated, actor);
	const expectedDraft = normalizePostDraftIds(
		ctx,
		resolveSanityBlogReconciliationPostDraft(plan, item),
	);
	const expectedChecksum = await checksumPostDraft(expectedDraft);
	const actualChecksum = await checksumPostDraft(loaded.draft);
	if (
		loaded.revision.checksum !== expectedChecksum
		|| actualChecksum !== expectedChecksum
	) throw new Error("Blog publication Post revision drifted");
	const published = toPublishedPostDraft(loaded.draft);
	if (published.slug !== validated.slug) throw new Error("Blog publication Post slug drifted");
	await requireContentSlugAvailable(ctx, {
		siteUrl: plan.siteUrl,
		kind: "post",
		slug: published.slug,
		documentId: validated._id,
	});
	await requirePostDraftRelations(ctx, plan.siteUrl, loaded.draft, mode === "replay");
	return { kind: "post", item, document: validated, revisionId, draft: loaded.draft };
}

async function preparePublication(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
	items: PublicationItem[],
	documents: Doc<"contentDocuments">[],
	mode: PublicationMode,
	digest: string,
) {
	const actor = reconciliationActor(plan, digest);
	const prepared: PreparedItem[] = [];
	for (const [index, entry] of items.entries()) {
		const document = documents[index];
		if (!document) throw new Error("Blog publication target is missing");
		prepared.push(
			entry.kind === "post"
				? await preparePost(ctx, plan, entry, document, mode, actor)
				: await prepareSupporting(ctx, plan, entry, document, mode, actor),
		);
	}
	return prepared;
}

function resultDocuments(prepared: PreparedItem[]) {
	return prepared.map(({ kind, item, document, revisionId }) => ({
		kind,
		documentKey: item.documentKey,
		documentId: document._id,
		revisionId,
	}));
}

function requireExactReplayPublication(
	prepared: PreparedItem[],
	actor: string,
) {
	const timestamps = new Set<number>();
	for (const { document, revisionId } of prepared) {
		if (
			document.publishedRevisionId !== revisionId
			|| document.draftRevisionId !== undefined
			|| document.publishedAt === undefined
			|| document.publishedBy !== actor
			|| document.updatedAt !== document.publishedAt
			|| document.updatedBy !== actor
		) throw new Error(PARTIAL_ERROR);
		timestamps.add(document.publishedAt);
	}
	if (timestamps.size !== 1) throw new Error(PARTIAL_ERROR);
}

/** Publish the exact reconciled Blog manifest atomically, or prove an exact zero-write replay. */
export async function publishReconciledSanityBlogDrafts(
	ctx: MutationCtx,
	args: { plan: SanityBlogReconciliationPlan; digest: string },
) {
	const digest = await requireSanityBlogReconciliationPlan(args.plan, args.digest);
	requireExactModuleShape(args.plan);
	const items = planItems(args.plan);
	const documents = await loadExactDocuments(ctx, args.plan, items);
	const published = await requireNoOutsidePublishedDocuments(ctx, args.plan, documents);
	const mode = publicationMode(documents, published);
	const prepared = await preparePublication(
		ctx,
		args.plan,
		items,
		documents,
		mode,
		digest,
	);
	const actor = publicationActor(args.plan, digest);

	if (mode === "replay") {
		requireExactReplayPublication(prepared, actor);
		return {
			status: "identical-replay" as const,
			digest,
			documents: resultDocuments(prepared),
		};
	}

	const publishedAt = Math.max(
		Date.now(),
		...prepared.map(({ document }) => document.updatedAt + 1),
	);
	for (const { document, revisionId } of prepared.filter(
		(item): item is PreparedSupporting => item.kind !== "post",
	)) {
		await ctx.db.patch(document._id, {
			draftRevisionId: undefined,
			publishedRevisionId: revisionId,
			publishedAt,
			publishedBy: actor,
			updatedAt: publishedAt,
			updatedBy: actor,
		});
	}
	for (const item of prepared.filter(
		(candidate): candidate is PreparedPost => candidate.kind === "post",
	)) {
		await requirePostDraftRelations(ctx, args.plan.siteUrl, item.draft, true);
		await ctx.db.patch(item.document._id, {
			draftRevisionId: undefined,
			publishedRevisionId: item.revisionId,
			publishedAt,
			publishedBy: actor,
			updatedAt: publishedAt,
			updatedBy: actor,
		});
	}
	return {
		status: "published" as const,
		digest,
		documents: resultDocuments(prepared),
	};
}
