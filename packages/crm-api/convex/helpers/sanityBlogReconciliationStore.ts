import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx } from "../_generated/server";
import {
	blogContentChecksumInput,
	type BlogSupportingDraft,
} from "./blogContentValidators";
import {
	assertBlogDocument,
	checksumBlogDraft,
	loadBlogRevision,
	requireReadyAuthorPortrait,
} from "./blogContentData";
import { insertBlogRevision } from "./blogContentStore";
import { requireContentSlugAvailable } from "./contentSlugHistory";
import {
	assertPostDocument,
	checksumPostDraft,
	checksumPostSummary,
	loadPostRevision,
	normalizePostDraftIds,
	requirePostDraftRelations,
} from "./postContentGraph";
import { insertPostRevision } from "./postContentStore";
import {
	assertSanityBlogReconciliationPredecessor,
	requireSanityBlogReconciliationPlan,
	resolveSanityBlogReconciliationPostDraft,
	type SanityBlogReconciliationPlan,
} from "./sanityBlogReconciliationPlan";
import type { SanityBlogImportReleaseContract } from "./sanityBlogImportPlan";

type ReconciliationKind = "author" | "category" | "post";

type ReconciliationResult = {
	kind: ReconciliationKind;
	documentKey: string;
	documentId: Id<"contentDocuments">;
	revisionId: Id<"contentRevisions">;
};

type PlanItem =
	| SanityBlogReconciliationPlan["authors"][number]
	| SanityBlogReconciliationPlan["categories"][number]
	| SanityBlogReconciliationPlan["posts"][number];

function predecessorActor(plan: SanityBlogReconciliationPlan) {
	return `sanityImport:${plan.predecessor.migrationId}:${plan.predecessor.source.projectId}/${plan.predecessor.source.dataset}`;
}

function reconciliationActor(plan: SanityBlogReconciliationPlan, digest: string) {
	return `sanityReconcile:${plan.migrationId}:${plan.decisionSet.id}:${digest}`;
}

function planItems(plan: SanityBlogReconciliationPlan) {
	return [
		...plan.authors.map((item) => ({ kind: "author" as const, item })),
		...plan.categories.map((item) => ({ kind: "category" as const, item })),
		...plan.posts.map((item) => ({ kind: "post" as const, item })),
	];
}

async function requireTenant(ctx: MutationCtx, siteUrl: string) {
	const tenant = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.unique();
	if (!tenant) throw new Error("Reconciliation tenant does not exist");
}

async function requireReadyAssets(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
) {
	for (const mapping of plan.assetMappings) {
		const asset = await ctx.db.get(mapping.mediaAssetId);
		if (!asset || asset.siteUrl !== plan.siteUrl || asset.status !== "ready") {
			throw new Error("Reconciliation media is missing, foreign, or not ready");
		}
	}
}

async function getDocument(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
	kind: ReconciliationKind,
	item: PlanItem,
) {
	const document = await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_documentKey", (q) =>
			q
				.eq("siteUrl", plan.siteUrl)
				.eq("kind", kind)
				.eq("documentKey", item.documentKey),
		)
		.unique();
	if (!document || document._id !== item.target.documentId) {
		throw new Error("Reconciliation target identity drifted");
	}
	return document;
}

function requireUnpublishedActiveDocument(
	document: Doc<"contentDocuments">,
	item: PlanItem,
) {
	if (
		document.documentKey !== item.documentKey
		|| document.rank !== item.target.rank
		|| document.publishedRevisionId !== undefined
		|| document.publishedAt !== undefined
		|| document.publishedBy !== undefined
		|| document.archivedAt !== undefined
		|| document.archivedBy !== undefined
	) throw new Error("Reconciliation target is not the accepted unpublished document");
}

async function revisionRows(
	ctx: MutationCtx,
	documentId: Id<"contentDocuments">,
) {
	return await ctx.db
		.query("contentRevisions")
		.withIndex("by_documentId_and_createdAt", (q) => q.eq("documentId", documentId))
		.take(3);
}

async function requireBaselineRevision(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
	item: PlanItem,
	actor: string,
) {
	const revision = await ctx.db.get(item.target.draftRevisionId);
	if (
		!revision
		|| revision.documentId !== document._id
		|| revision.siteUrl !== document.siteUrl
		|| revision.kind !== document.kind
		|| revision.source !== "sanityImport"
		|| revision.createdBy !== actor
		|| revision.createdAt !== document.createdAt
		|| revision.checksum !== item.target.draftChecksum
		|| revision.restoredFromRevisionId !== undefined
		|| revision.restoreOperationId !== undefined
		|| revision.restoreRequestDigest !== undefined
	) throw new Error("Accepted v1 Blog revision provenance drifted");

	if (document.kind === "post") {
		const loaded = await loadPostRevision(ctx, assertPostDocument(document), revision._id);
		if (!loaded || (await checksumPostDraft(loaded.draft)) !== item.target.draftChecksum) {
			throw new Error("Accepted v1 Post graph drifted");
		}
	} else {
		if (document.kind !== "author" && document.kind !== "category") {
			throw new Error("Accepted v1 supporting document kind drifted");
		}
		const supporting = assertBlogDocument(document, document.kind);
		const loaded = await loadBlogRevision(ctx, supporting, revision._id);
		if (
			!loaded
			|| (await checksumBlogDraft(blogContentChecksumInput(loaded.draft)))
				!== item.target.draftChecksum
		) throw new Error("Accepted v1 supporting draft drifted");
	}
	return revision;
}

async function requireUntouchedBaseline(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
	item: PlanItem,
	actor: string,
) {
	requireUnpublishedActiveDocument(document, item);
	if (
		document.draftRevisionId !== item.target.draftRevisionId
		|| document.slug !== item.target.documentSlug
		|| document.createdBy !== actor
		|| document.updatedBy !== actor
		|| document.createdAt !== document.updatedAt
	) throw new Error("Accepted v1 Blog draft is no longer untouched");
	const revisions = await revisionRows(ctx, document._id);
	if (revisions.length !== 1 || revisions[0]._id !== item.target.draftRevisionId) {
		throw new Error("Accepted v1 Blog revision set drifted");
	}
	await requireBaselineRevision(ctx, document, item, actor);
}

async function finalChecksum(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
	kind: ReconciliationKind,
	item: PlanItem,
) {
	if (kind === "post") {
		return await checksumPostDraft(
			normalizePostDraftIds(
				ctx,
				resolveSanityBlogReconciliationPostDraft(
					plan,
					item as SanityBlogReconciliationPlan["posts"][number],
				),
			),
		);
	}
	return await checksumBlogDraft(
		blogContentChecksumInput(
			(item as SanityBlogReconciliationPlan["authors"][number]).draft,
		),
	);
}

async function requireExactReplay(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
	documents: ReadonlyMap<string, Doc<"contentDocuments">>,
	predecessor: string,
	actor: string,
) {
	const results: ReconciliationResult[] = [];
	const timestamps = new Set<number>();
	for (const { kind, item } of planItems(plan)) {
		const document = documents.get(item.documentKey);
		if (!document) throw new Error("Reconciliation replay is partial");
		requireUnpublishedActiveDocument(document, item);
		if (
			document.draftRevisionId === undefined
			|| document.draftRevisionId === item.target.draftRevisionId
			|| document.createdBy !== predecessor
			|| document.updatedBy !== actor
			|| document.updatedAt === document.createdAt
			|| document.slug !== item.draft.slug
		) throw new Error("Reconciliation replay document drifted");
		const revisions = await revisionRows(ctx, document._id);
		if (
			revisions.length !== 2
			|| !revisions.some(({ _id }) => _id === item.target.draftRevisionId)
			|| !revisions.some(({ _id }) => _id === document.draftRevisionId)
		) throw new Error("Reconciliation replay revision set drifted");
		await requireBaselineRevision(ctx, document, item, predecessor);
		const current = await ctx.db.get(document.draftRevisionId);
		const checksum = await finalChecksum(ctx, plan, kind, item);
		if (
			!current
			|| current.documentId !== document._id
			|| current.siteUrl !== document.siteUrl
			|| current.kind !== kind
			|| current.source !== "sanityImport"
			|| current.createdBy !== actor
			|| current.createdAt !== document.updatedAt
			|| current.checksum !== checksum
			|| current.restoredFromRevisionId !== undefined
			|| current.restoreOperationId !== undefined
			|| current.restoreRequestDigest !== undefined
		) throw new Error("Reconciliation replay provenance drifted");
		if (kind === "post") {
			const loaded = await loadPostRevision(ctx, assertPostDocument(document), current._id);
			if (!loaded || (await checksumPostDraft(loaded.draft)) !== checksum) {
				throw new Error("Reconciliation replay Post graph drifted");
			}
		} else {
			const loaded = await loadBlogRevision(
				ctx,
				assertBlogDocument(document, kind),
				current._id,
			);
			if (
				!loaded
				|| (await checksumBlogDraft(blogContentChecksumInput(loaded.draft))) !== checksum
			) throw new Error("Reconciliation replay supporting draft drifted");
		}
		timestamps.add(current.createdAt);
		results.push({
			kind,
			documentKey: item.documentKey,
			documentId: document._id,
			revisionId: current._id,
		});
	}
	if (timestamps.size !== 1) throw new Error("Reconciliation replay was not one atomic batch");
	return results;
}

async function preflightFinalDrafts(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
) {
	for (const item of [...plan.authors, ...plan.categories]) {
		await requireContentSlugAvailable(ctx, {
			siteUrl: plan.siteUrl,
			kind: item.draft.kind,
			slug: item.draft.slug,
			documentId: item.target.documentId,
		});
		await requireReadyAuthorPortrait(ctx, plan.siteUrl, item.draft);
	}
	for (const item of plan.posts) {
		const draft = normalizePostDraftIds(
			ctx,
			resolveSanityBlogReconciliationPostDraft(plan, item),
		);
		await requireContentSlugAvailable(ctx, {
			siteUrl: plan.siteUrl,
			kind: "post",
			slug: draft.slug,
			documentId: item.target.documentId,
		});
		await requirePostDraftRelations(ctx, plan.siteUrl, draft, false);
	}
}

async function writeReconciliation(
	ctx: MutationCtx,
	plan: SanityBlogReconciliationPlan,
	documents: ReadonlyMap<string, Doc<"contentDocuments">>,
	actor: string,
) {
	await preflightFinalDrafts(ctx, plan);
	const now = Math.max(
		Date.now(),
		...Array.from(documents.values(), ({ updatedAt }) => updatedAt + 1),
	);
	const writer = { actor, now, source: "sanityImport" as const };
	const results: ReconciliationResult[] = [];
	for (const item of [...plan.authors, ...plan.categories]) {
		const document = documents.get(item.documentKey);
		if (!document) throw new Error("Reconciliation target is partial");
		const draft = item.draft as BlogSupportingDraft;
		const checksum = await checksumBlogDraft(blogContentChecksumInput(draft));
		const revisionId = await insertBlogRevision(ctx, document, draft, checksum, writer);
		await ctx.db.patch(document._id, {
			slug: draft.slug,
			draftRevisionId: revisionId,
			updatedAt: now,
			updatedBy: actor,
		});
		results.push({
			kind: draft.kind,
			documentKey: item.documentKey,
			documentId: document._id,
			revisionId,
		});
	}
	for (const item of plan.posts) {
		const document = documents.get(item.documentKey);
		if (!document) throw new Error("Reconciliation target is partial");
		const draft = normalizePostDraftIds(
			ctx,
			resolveSanityBlogReconciliationPostDraft(plan, item),
		);
		const checksum = await checksumPostDraft(draft);
		const summaryChecksum = await checksumPostSummary(draft);
		const revisionId = await insertPostRevision(
			ctx,
			document,
			draft,
			checksum,
			summaryChecksum,
			writer,
		);
		await ctx.db.patch(document._id, {
			slug: draft.slug,
			draftRevisionId: revisionId,
			updatedAt: now,
			updatedBy: actor,
		});
		results.push({
			kind: "post",
			documentKey: item.documentKey,
			documentId: document._id,
			revisionId,
		});
	}
	return results;
}

/**
 * Atomically advance only the exact untouched v1 drafts, or prove an exact
 * prior v2 replay without writing. Any mixed or drifted state is rejected.
 */
export async function reconcileSanityBlogDrafts(
	ctx: MutationCtx,
	args: {
		plan: SanityBlogReconciliationPlan;
		digest: string;
		predecessorContract: SanityBlogImportReleaseContract;
	},
) {
	const digest = await requireSanityBlogReconciliationPlan(args.plan, args.digest);
	assertSanityBlogReconciliationPredecessor(args.plan, args.predecessorContract);
	await requireTenant(ctx, args.plan.siteUrl);
	await requireReadyAssets(ctx, args.plan);
	const entries = planItems(args.plan);
	const documents = new Map<string, Doc<"contentDocuments">>();
	for (const { kind, item } of entries) {
		documents.set(item.documentKey, await getDocument(ctx, args.plan, kind, item));
	}
	const baselineCount = entries.filter(
		({ item }) => documents.get(item.documentKey)?.draftRevisionId === item.target.draftRevisionId,
	).length;
	if (baselineCount !== 0 && baselineCount !== entries.length) {
		throw new Error("Reconciliation target is in a partial state");
	}
	const predecessor = predecessorActor(args.plan);
	const actor = reconciliationActor(args.plan, digest);
	if (baselineCount === 0) {
		return {
			status: "identical-replay" as const,
			digest,
			documents: await requireExactReplay(
				ctx,
				args.plan,
				documents,
				predecessor,
				actor,
			),
		};
	}
	for (const { item } of entries) {
		const document = documents.get(item.documentKey);
		if (!document) throw new Error("Reconciliation target is partial");
		await requireUntouchedBaseline(ctx, document, item, predecessor);
	}
	return {
		status: "reconciled" as const,
		digest,
		documents: await writeReconciliation(ctx, args.plan, documents, actor),
	};
}
