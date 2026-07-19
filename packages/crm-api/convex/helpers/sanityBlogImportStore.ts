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
} from "./blogContentData";
import { createBlogDraftForSite } from "./blogContentStore";
import {
	checksumPostDraft,
	loadPostRevision,
	normalizePostDraftIds,
} from "./postContentGraph";
import { createPostDraftForSite } from "./postContentStore";
import type { PostDraft } from "./postContentValidators";
import {
	requireReleasedSanityBlogImportPlan,
	type SanityBlogImportPlan,
	type SanityBlogImportReleaseContract,
} from "./sanityBlogImportPlan";

type ImportDocumentKind = "author" | "category" | "post";

type ImportDocumentResult = {
	kind: ImportDocumentKind;
	documentKey: string;
	documentId: Id<"contentDocuments">;
	revisionId: Id<"contentRevisions">;
};

function migrationActor(contract: SanityBlogImportReleaseContract) {
	return `sanityImport:${contract.migrationId}:${contract.source.projectId}/${contract.source.dataset}`;
}

async function getDocumentByKey(
	ctx: MutationCtx,
	siteUrl: string,
	kind: ImportDocumentKind,
	documentKey: string,
) {
	return await ctx.db
		.query("contentDocuments")
		.withIndex("by_siteUrl_and_kind_and_documentKey", (q) =>
			q.eq("siteUrl", siteUrl).eq("kind", kind).eq("documentKey", documentKey),
		)
		.unique();
}

function finalPostDraft(
	plan: SanityBlogImportPlan["posts"][number],
	documentIds: ReadonlyMap<string, Id<"contentDocuments">>,
): PostDraft {
	const authorDocumentId = documentIds.get(plan.authorDocumentKey);
	if (!authorDocumentId) throw new Error("Import Post Author target was not created");
	return {
		...plan.draft,
		authorDocumentId,
		categories: plan.categoryReferences.map((reference) => {
			const documentId = documentIds.get(reference.documentKey);
			if (!documentId) throw new Error("Import Post Category target was not created");
			return { key: reference.key, documentId };
		}),
	};
}

async function requireImportTenant(ctx: MutationCtx, siteUrl: string) {
	const tenant = await ctx.db
		.query("platformClients")
		.withIndex("by_siteUrl", (q) => q.eq("siteUrl", siteUrl))
		.unique();
	if (!tenant) throw new Error("Released import tenant does not exist");
	return tenant;
}

async function requireReadyImportAssets(
	ctx: MutationCtx,
	plan: SanityBlogImportPlan,
) {
	for (const mapping of plan.assetMappings) {
		const asset = await ctx.db.get(mapping.mediaAssetId);
		if (
			!asset
			|| asset.siteUrl !== plan.siteUrl
			|| asset.status !== "ready"
		) throw new Error("Released import media is missing, foreign, or not ready");
	}
}

function requireUntouchedImportDocument(
	document: Doc<"contentDocuments">,
	args: {
		kind: ImportDocumentKind;
		documentKey: string;
		slug?: string;
		actor: string;
	},
) {
	if (
		document.kind !== args.kind
		|| document.documentKey !== args.documentKey
		|| document.slug !== args.slug
		|| !document.draftRevisionId
		|| document.publishedRevisionId
		|| document.publishedAt !== undefined
		|| document.publishedBy !== undefined
		|| document.archivedAt !== undefined
		|| document.archivedBy !== undefined
		|| document.createdBy !== args.actor
		|| document.updatedBy !== args.actor
		|| document.createdAt !== document.updatedAt
	) throw new Error("Existing import document is not an untouched unpublished draft");
}

async function requireOnlyImportRevision(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
	actor: string,
) {
	const revisions = await ctx.db
		.query("contentRevisions")
		.withIndex("by_documentId_and_createdAt", (q) =>
			q.eq("documentId", document._id),
		)
		.take(2);
	if (
		revisions.length !== 1
		|| revisions[0]._id !== document.draftRevisionId
		|| revisions[0].source !== "sanityImport"
		|| revisions[0].createdBy !== actor
		|| revisions[0].createdAt !== document.createdAt
	) throw new Error("Existing import revision provenance is not an exact replay");
	return revisions[0];
}

async function verifySupportingReplay(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
	item: { documentKey: string; draft: BlogSupportingDraft },
	actor: string,
) {
	requireUntouchedImportDocument(document, {
		kind: item.draft.kind,
		documentKey: item.documentKey,
		slug: item.draft.slug,
		actor,
	});
	const revision = await requireOnlyImportRevision(ctx, document, actor);
	const supportingDocument = assertBlogDocument(document, item.draft.kind);
	const loaded = await loadBlogRevision(ctx, supportingDocument, revision._id);
	if (!loaded) throw new Error("Existing import supporting revision is missing");
	const expectedChecksum = await checksumBlogDraft(
		blogContentChecksumInput(item.draft),
	);
	const loadedChecksum = await checksumBlogDraft(
		blogContentChecksumInput(loaded.draft),
	);
	if (
		revision.checksum !== expectedChecksum
		|| loadedChecksum !== expectedChecksum
	) {
		throw new Error("Existing import supporting revision changed");
	}
	return {
		kind: item.draft.kind,
		documentKey: item.documentKey,
		documentId: document._id,
		revisionId: revision._id,
	} satisfies ImportDocumentResult;
}

async function verifyPostReplay(
	ctx: MutationCtx,
	document: Doc<"contentDocuments">,
	item: SanityBlogImportPlan["posts"][number],
	documentIds: ReadonlyMap<string, Id<"contentDocuments">>,
	actor: string,
) {
	requireUntouchedImportDocument(document, {
		kind: "post",
		documentKey: item.documentKey,
		slug: item.draft.slug,
		actor,
	});
	const revision = await requireOnlyImportRevision(ctx, document, actor);
	const draft = normalizePostDraftIds(ctx, finalPostDraft(item, documentIds));
	const loaded = await loadPostRevision(ctx, document, revision._id);
	if (!loaded) throw new Error("Existing import Post revision is missing");
	const checksum = await checksumPostDraft(draft);
	if (revision.checksum !== checksum) throw new Error("Existing import Post graph changed");
	return {
		kind: "post",
		documentKey: item.documentKey,
		documentId: document._id,
		revisionId: revision._id,
	} satisfies ImportDocumentResult;
}

async function existingImportDocuments(
	ctx: MutationCtx,
	plan: SanityBlogImportPlan,
) {
	const entries: Array<{ kind: ImportDocumentKind; documentKey: string }> = [
		...plan.authors.map((item) => ({ kind: "author" as const, documentKey: item.documentKey })),
		...plan.categories.map((item) => ({
			kind: "category" as const,
			documentKey: item.documentKey,
		})),
		...plan.posts.map((item) => ({ kind: "post" as const, documentKey: item.documentKey })),
	];
	const documents = await Promise.all(
		entries.map(async ({ kind, documentKey }) => ({
			kind,
			documentKey,
			document: await getDocumentByKey(ctx, plan.siteUrl, kind, documentKey),
		})),
	);
	return documents;
}

async function verifyIdenticalReplay(
	ctx: MutationCtx,
	plan: SanityBlogImportPlan,
	existing: Awaited<ReturnType<typeof existingImportDocuments>>,
	actor: string,
) {
	const documentIds = new Map<string, Id<"contentDocuments">>();
	for (const entry of existing) {
		if (!entry.document) throw new Error("Import replay is partial");
		documentIds.set(entry.documentKey, entry.document._id);
	}
	const existingByKey = new Map(
		existing.map((entry) => [entry.documentKey, entry.document] as const),
	);
	const documents: ImportDocumentResult[] = [];
	for (const item of [...plan.authors, ...plan.categories]) {
		const document = existingByKey.get(item.documentKey);
		if (!document) throw new Error("Import replay is partial");
		documents.push(
			await verifySupportingReplay(ctx, document, item, actor),
		);
	}
	for (const item of plan.posts) {
		const document = existingByKey.get(item.documentKey);
		if (!document) throw new Error("Import replay is partial");
		documents.push(
			await verifyPostReplay(ctx, document, item, documentIds, actor),
		);
	}
	const postRanks = existing
		.filter((entry) => entry.kind === "post")
		.map((entry) => entry.document?.rank);
	if (
		postRanks.some((rank) => !Number.isSafeInteger(rank))
		|| postRanks.some((rank, index) =>
			index > 0 && rank !== (postRanks[0] ?? 0) + index,
		)
	) throw new Error("Existing import Post rank order changed");
	return documents;
}

/** Execute or exactly replay one fixed, all-or-nothing unpublished Blog batch. */
export async function importReleasedSanityBlogDrafts(
	ctx: MutationCtx,
	args: {
		plan: SanityBlogImportPlan;
		digest: string;
		contract: SanityBlogImportReleaseContract;
	},
) {
	const digest = await requireReleasedSanityBlogImportPlan(
		args.plan,
		args.digest,
		args.contract,
	);
	await requireImportTenant(ctx, args.plan.siteUrl);
	await requireReadyImportAssets(ctx, args.plan);
	const existing = await existingImportDocuments(ctx, args.plan);
	const existingCount = existing.filter((entry) => entry.document).length;
	const actor = migrationActor(args.contract);
	if (existingCount > 0 && existingCount < existing.length) {
		throw new Error("Released Blog import target is in a partial state");
	}
	if (existingCount === existing.length) {
		return {
			status: "identical-replay" as const,
			digest,
			documents: await verifyIdenticalReplay(ctx, args.plan, existing, actor),
		};
	}

	const writer = { actor, source: "sanityImport" as const, now: Date.now() };
	const documents: ImportDocumentResult[] = [];
	const documentIds = new Map<string, Id<"contentDocuments">>();
	for (const item of [...args.plan.authors, ...args.plan.categories]) {
		const created = await createBlogDraftForSite(ctx, {
			siteUrl: args.plan.siteUrl,
			documentKey: item.documentKey,
			draft: item.draft,
			writer,
		});
		if (!created.created) throw new Error("Released supporting import was not new");
		documentIds.set(item.documentKey, created.documentId);
		documents.push({
			kind: item.draft.kind,
			documentKey: item.documentKey,
			documentId: created.documentId,
			revisionId: created.revisionId,
		});
	}
	for (const item of args.plan.posts) {
		const created = await createPostDraftForSite(ctx, {
			siteUrl: args.plan.siteUrl,
			documentKey: item.documentKey,
			draft: finalPostDraft(item, documentIds),
			writer,
		});
		if (!created.created) throw new Error("Released Post import was not new");
		documents.push({
			kind: "post",
			documentKey: item.documentKey,
			documentId: created.documentId,
			revisionId: created.revisionId,
		});
	}
	return { status: "imported" as const, digest, documents };
}
